// Copyright (c) 2026 The Orbit Authors
// SPDX-License-Identifier: Apache-2.0

import {createServer, type Server} from 'node:http'

import type {PrometheusOperationalMetrics} from '../../core/metrics.js'

export interface MetricsServer {
  close(): Promise<void>
  port: number
  url: string
}

/** A separate, opt-in endpoint. The GUI capability token is never accepted here. */
export async function startMetricsServer(metrics: PrometheusOperationalMetrics, port: number): Promise<MetricsServer> {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('Invalid metrics port.')
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/metrics') {
      response.writeHead(404).end()
      return
    }

    metrics.render().then(
      (body) => {
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': metrics.contentType,
          'X-Content-Type-Options': 'nosniff',
        })
        response.end(body)
      },
      () => response.writeHead(500).end(),
    )
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Metrics server did not bind to a TCP port.')
  return {
    close: () => close(server),
    port: address.port,
    url: `http://127.0.0.1:${address.port}/metrics`,
  }
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
    server.closeAllConnections()
  })
}
