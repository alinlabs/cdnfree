import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { logging, server as wispServer } from '@mercuryworkshop/wisp-js/server';

let wispConfigured = false;

export function configureWispServer(): void {
  if (wispConfigured) return;
  wispConfigured = true;

  logging.set_level(logging.WARN);
  wispServer.options.allow_private_ips = false;
  wispServer.options.allow_loopback_ips = false;
  wispServer.options.allow_direct_ip = false;
  wispServer.options.port_whitelist = [80, 443];
  wispServer.options.dns_result_order = 'ipv4first';
}

export interface WispUpgradeOptions {
  allowOtherUpgrades?: boolean;
}

export function attachWispUpgradeHandler(
  httpServer: HttpServer,
  options: WispUpgradeOptions = {},
): void {
  configureWispServer();

  httpServer.on(
    'upgrade',
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      let pathname = '/';
      try {
        pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      } catch {
        socket.destroy();
        return;
      }

      if (pathname === '/wisp/' || pathname === '/wisp') {
        req.url = '/wisp/';
        wispServer.routeRequest(req, socket, head);
        return;
      }

      if (!options.allowOtherUpgrades) {
        socket.end();
      }
    },
  );
}
