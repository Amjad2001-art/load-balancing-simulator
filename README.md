# Adaptive Frontend Load Balancer

React/Vite project for a Distributed Systems assignment. The app simulates a frontend proxy dispatcher that routes outbox payloads across replication nodes using multiple load-balancing strategies.

## Implemented Strategies

- Round Robin
- Weighted Round Robin
- Smooth Weighted Round Robin
- Consistent Hashing
- Adaptive Feedback
- Latency Based
- Performance Based
- Server Mesh
- Idle Join Queue
- Least Connections
- Weighted Least Connections

## Features

- Simulated traffic bursts with live metrics updates.
- Per-server CPU, connections, queue, average RTT, last burst count, and mesh score.
- Offline node handling with high-contrast status banners.
- Server-C peak-load isolation when CPU exceeds 90% or connections exceed 150.
- Least Connections fallback after overload isolation.
- Sliding response-time comparison for latency/performance routing policies.
- Outbox dispatch stream showing payload id, key, type, target server, and round-trip time.

## Run Locally

Install dependencies:

```powershell
npm install
```

Start the development server:

```powershell
npm.cmd run dev -- --port 5173
```

Open:

```text
http://127.0.0.1:5173
```

## Build

```powershell
npm.cmd run build
```
