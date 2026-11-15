declare module '@mercuryworkshop/wisp-js/server' {
  import type { IncomingMessage } from 'node:http';
  import type { Duplex } from 'node:stream';

  export interface WispServerOptions {
    allow_private_ips?: boolean;
    allow_loopback_ips?: boolean;
    allow_direct_ip?: boolean;
    port_whitelist?: number[];
    dns_result_order?: string;
    [key: string]: unknown;
  }

  export const logging: {
    WARN: number;
    INFO: number;
    ERROR: number;
    DEBUG: number;
    NONE: number;
    set_level: (level: number) => void;
  };

  export const server: {
    options: WispServerOptions;
    routeRequest: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  };
}
