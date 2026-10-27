import { networkInterfaces, NetworkInterfaceInfo } from 'node:os';
import { isPrivateIpv4 } from './config-policy';
export function approvedInterfaces(env: NodeJS.ProcessEnv, interfaces = networkInterfaces()) {
  if (env.ALLOW_LAN_DEV !== 'true') return [];
  const aliases: string[] = env.API_LAN_INTERFACES ? JSON.parse(env.API_LAN_INTERFACES) : [];
  return Object.entries(interfaces).flatMap(([alias, entries]) => (entries ?? []).filter(n => n.family === 'IPv4' && !n.internal && isPrivateIpv4(n.address) &&
    (env.API_LAN_ADDRESS === 'auto' ? aliases.includes(alias) : n.address === env.API_LAN_ADDRESS)).map(n => ({ ...n, alias })));
}
const ipv4Number = (s: string) => s.split('.').reduce((n, p) => ((n << 8) | Number(p)) >>> 0, 0);
export function onSubnet(address: string, iface: Pick<NetworkInterfaceInfo, 'address' | 'netmask'>) {
  return isPrivateIpv4(address) && ((ipv4Number(address) & ipv4Number(iface.netmask)) >>> 0) === ((ipv4Number(iface.address) & ipv4Number(iface.netmask)) >>> 0);
}
