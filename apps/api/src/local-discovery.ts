import { Injectable, OnApplicationShutdown, OnApplicationBootstrap } from '@nestjs/common';
import { createSocket, Socket } from 'node:dgram';
import { Bonjour } from 'bonjour-service';
import { approvedInterfaces, onSubnet } from './local-network';
import { connectionIdentity } from './connection-identity';
@Injectable()
export class LocalDiscovery implements OnApplicationBootstrap, OnApplicationShutdown {
  private socket?: Socket;
  private timer?: NodeJS.Timeout;
  private advertised = '';
  private instances: Bonjour[] = [];
  onApplicationBootstrap() {
    if (process.env.ALLOW_LAN_DEV !== 'true') return;
    const identity = connectionIdentity(process.env.JWT_SECRET!);
    const socket = this.socket = createSocket({ type: 'udp4', reuseAddr: true });
    const recent = new Map<string, number>();
    socket.on('error', () => console.warn('Local broadcast discovery unavailable; use clinic connection settings.'));
    socket.on('message', (bytes, remote) => {
      if (bytes.length > 256 || !approvedInterfaces(process.env).some(n => onSubnet(remote.address, n))) return;
      const now = Date.now();
      if (now - (recent.get(remote.address) ?? 0) < 500) return;
      try {
        const request = JSON.parse(bytes.toString());
        if (request.service !== 'CareSlot discovery' || request.protocol !== 1 || !/^[a-f0-9]{32}$/.test(request.nonce)) return;
        recent.set(remote.address, now);
        if (recent.size > 256) for (const [ip, at] of recent) if (now - at > 10000) recent.delete(ip);
        if (recent.size > 512) recent.clear();
        const response = Buffer.from(JSON.stringify({ ...identity.proof(request.nonce, process.env.CLINIC_NAME ?? 'CareSlot Clinic'), port: Number(process.env.API_PORT ?? 3001) }));
        socket.send(response, remote.port, remote.address, () => {});
      } catch { /* Ignore unrelated or malformed datagrams. */ }
    });
    socket.bind(3002, '0.0.0.0');
    this.refreshAdvertisements(identity.serverId);
    this.timer = setInterval(() => this.refreshAdvertisements(identity.serverId), 5000); this.timer.unref();
  }
  private refreshAdvertisements(serverId: string) {
    const addresses = approvedInterfaces(process.env).map(n => n.address).sort();
    const fingerprint = addresses.join(',');
    if (fingerprint === this.advertised) return;
    this.stopAdvertisements(); this.advertised = fingerprint;
    for (const address of addresses) {
      try {
        // bonjour-service forwards these options to multicast-dns (its public type omits interface).
        const options = { interface: address, port: 5353 };
        const instance = new Bonjour(options, () => {});
        const service = instance.publish({ name: `CareSlot ${serverId.slice(0, 10)}`, type: 'careslot', port: Number(process.env.API_PORT ?? 3001), txt: { protocol: '1', id: serverId }, disableIPv6: true });
        service.on('error', () => {}); this.instances.push(instance);
      } catch { console.warn('mDNS discovery unavailable on one interface; broadcast/manual connection remains available.'); }
    }
  }
  private stopAdvertisements() { for (const instance of this.instances) { try { instance.unpublishAll(); instance.destroy(); } catch {} } this.instances = []; }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); this.stopAdvertisements(); try { this.socket?.close(); } catch {} }
}
