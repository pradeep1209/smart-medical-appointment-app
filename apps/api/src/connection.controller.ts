import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { connectionIdentity } from './connection-identity';
@Controller('connection')
export class ConnectionController {
  private readonly identity = connectionIdentity(process.env.JWT_SECRET!);
  @Get()
  details(@Query('nonce') nonce: string) {
    if (typeof nonce !== 'string' || !/^[a-f0-9]{32}$/.test(nonce)) throw new BadRequestException('A valid connection challenge is required.');
    return this.identity.proof(nonce, process.env.CLINIC_NAME ?? 'CareSlot Clinic');
  }
}
