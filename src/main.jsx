import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const STRATEGIES = [
  ['round-robin', 'Round Robin'],
  ['weighted-round-robin', 'Weighted Round Robin'],
  ['smooth-round-robin', 'Smooth Round Robin'],
  ['consistent-hashing', 'Consistent Hashing'],
  ['adaptive-feedback', 'Adaptive Feedback'],
  ['latency-based', 'Latency Based'],
  ['performance-based', 'Performance Based'],
  ['server-mesh', 'Server Mesh'],
  ['idle-join-queue', 'Idle-Join Queue'],
  ['least-connections', 'Least Connections'],
  ['weighted-least-connections', 'Weighted Least Connections']
];

const INITIAL_SERVERS = [
  { id: 'Server-A', region: 'us-east', weight: 2, online: true, connections: 42, cpu: 48, latency: 45, handled: 0, lastBurst: 0, queue: 6, meshScore: 82, smooth: 0, responseWindow: [42, 48, 45, 44, 46] },
  { id: 'Server-B', region: 'eu-west', weight: 4, online: true, connections: 36, cpu: 38, latency: 12, handled: 0, lastBurst: 0, queue: 3, meshScore: 94, smooth: 0, responseWindow: [12, 11, 13, 12, 12] },
  { id: 'Server-C', region: 'ap-south', weight: 1, online: true, connections: 78, cpu: 48, latency: 62, handled: 0, lastBurst: 0, queue: 9, meshScore: 71, smooth: 0, responseWindow: [59, 64, 62, 61, 63] },
  { id: 'Server-D', region: 'us-west', weight: 3, online: true, connections: 58, cpu: 52, latency: 28, handled: 0, lastBurst: 0, queue: 5, meshScore: 88, smooth: 0, responseWindow: [26, 30, 28, 29, 27] }
];

const PAYLOAD_TYPES = ['orders', 'replication', 'analytics', 'checkout', 'inventory'];

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function activeServers(servers) {
  return servers.filter((server) => server.online && !server.isolated);
}

function overloaded(server) {
  return server.cpu > 90 || server.connections > 150;
}

function shouldIsolate(server) {
  return server.id === 'Server-C' && server.peakLoad && overloaded(server);
}

function createPayload(sequence) {
  const type = PAYLOAD_TYPES[sequence % PAYLOAD_TYPES.length];
  return {
    id: `payload-${sequence}`,
    key: `${type}-${Math.floor(sequence / 3)}`,
    size: 1 + (sequence % 5),
    type
  };
}

function chooseServer(strategy, servers, payload, cursorRef) {
  const candidates = activeServers(servers);
  if (candidates.length === 0) return null;

  if (strategy === 'round-robin') {
    const target = candidates[cursorRef.current.rr % candidates.length];
    cursorRef.current.rr += 1;
    return target.id;
  }

  if (strategy === 'weighted-round-robin') {
    const ring = candidates.flatMap((server) => Array.from({ length: server.weight }, () => server));
    const target = ring[cursorRef.current.wrr % ring.length];
    cursorRef.current.wrr += 1;
    return target.id;
  }

  if (strategy === 'smooth-round-robin') {
    const totalWeight = candidates.reduce((sum, server) => sum + server.weight, 0);
    let best = candidates[0];
    candidates.forEach((server) => {
      server.smooth += server.weight;
      if (server.smooth > best.smooth) best = server;
    });
    best.smooth -= totalWeight;
    return best.id;
  }

  if (strategy === 'consistent-hashing') {
    const ring = candidates
      .flatMap((server) => Array.from({ length: server.weight * 24 }, (_, index) => ({
        server,
        hash: hashText(`${server.id}:${index}`)
      })))
      .sort((a, b) => a.hash - b.hash);
    const payloadHash = hashText(payload.key);
    return (ring.find((point) => point.hash >= payloadHash) ?? ring[0]).server.id;
  }

  if (strategy === 'adaptive-feedback') {
    return candidates
      .toSorted((a, b) => feedbackScore(a) - feedbackScore(b))[0].id;
  }

  if (strategy === 'latency-based') {
    return candidates
      .toSorted((a, b) => average(a.responseWindow) - average(b.responseWindow))[0].id;
  }

  if (strategy === 'performance-based') {
    return candidates
      .toSorted((a, b) => performanceScore(b) - performanceScore(a))[0].id;
  }

  if (strategy === 'server-mesh') {
    return candidates
      .toSorted((a, b) => meshRoutingScore(b) - meshRoutingScore(a))[0].id;
  }

  if (strategy === 'idle-join-queue') {
    return candidates
      .toSorted((a, b) => a.queue - b.queue || a.connections - b.connections)[0].id;
  }

  if (strategy === 'least-connections') {
    return candidates
      .toSorted((a, b) => a.connections - b.connections)[0].id;
  }

  if (strategy === 'weighted-least-connections') {
    return candidates
      .toSorted((a, b) => a.connections / a.weight - b.connections / b.weight)[0].id;
  }

  return candidates[0].id;
}

function feedbackScore(server) {
  return server.connections * 0.35 + server.cpu * 0.45 + average(server.responseWindow) * 0.2;
}

function performanceScore(server) {
  return server.weight * 30 + server.meshScore - server.cpu * 0.65 - average(server.responseWindow) * 1.2 - server.queue * 2;
}

function meshRoutingScore(server) {
  return server.meshScore + server.weight * 8 - server.connections * 0.12 - server.cpu * 0.4;
}

function routePayloads(strategy, servers, payloads, cursorRef) {
  const routed = [];
  const nextServers = servers.map((server) => ({ ...server, lastBurst: 0, responseWindow: [...server.responseWindow] }));

  payloads.forEach((payload) => {
    nextServers.forEach((server) => {
      if (shouldIsolate(server) && server.online) {
        server.isolated = true;
      }
    });

    const targetId = chooseServer(strategy, nextServers, payload, cursorRef);
    if (!targetId) {
      routed.push({ payload, targetId: 'No online node', status: 'dropped' });
      return;
    }

    const server = nextServers.find((item) => item.id === targetId);
    const pressureFactor = server.id === 'Server-C' && !server.peakLoad ? 0.28 : 0.55;
    const connectionFactor = server.id === 'Server-C' && !server.peakLoad ? 1 : 2;
    const queueFactor = server.id === 'Server-C' && !server.peakLoad ? 1.25 : 0.9;
    const burstPressure = payload.size * pressureFactor;
    const latencyJitter = Math.round((server.cpu / 100) * 8 + payload.size + Math.random() * 4);
    const roundTrip = Math.max(6, Math.round(server.latency + latencyJitter - server.weight));

    server.connections += payload.size * connectionFactor;
    server.cpu = Math.min(99, Math.round(server.cpu + burstPressure + server.connections * 0.015));
    server.queue = Math.max(0, Math.round(server.queue + payload.size - server.weight * queueFactor));
    server.latency = Math.round(server.latency * 0.72 + roundTrip * 0.28);
    server.handled += 1;
    server.lastBurst += 1;
    server.responseWindow = [...server.responseWindow.slice(-7), roundTrip];
    server.meshScore = Math.max(35, Math.round(server.meshScore - server.cpu * 0.01 + server.weight * 0.3));
    routed.push({ payload, targetId, status: 'delivered', roundTrip });
  });

  return { nextServers, routed };
}

function App() {
  const [strategy, setStrategy] = useState('latency-based');
  const [servers, setServers] = useState(INITIAL_SERVERS);
  const [events, setEvents] = useState([]);
  const [routeOrder, setRouteOrder] = useState([]);
  const [autoRun, setAutoRun] = useState(false);
  const [burstSize, setBurstSize] = useState(18);
  const [sequence, setSequence] = useState(1);
  const cursorRef = useRef({ rr: 0, wrr: 0 });

  const activeCount = activeServers(servers).length;
  const serverBAvg = average(servers.find((server) => server.id === 'Server-B').responseWindow);
  const serverAAvg = average(servers.find((server) => server.id === 'Server-A').responseWindow);
  const offlineCount = servers.filter((server) => !server.online).length;
  const isolatedServers = servers.filter((server) => server.isolated);

  const totals = useMemo(() => {
    const delivered = servers.reduce((sum, server) => sum + server.handled, 0);
    const avgLatency = Math.round(servers.reduce((sum, server) => sum + average(server.responseWindow), 0) / servers.length);
    const connections = servers.reduce((sum, server) => sum + server.connections, 0);
    return { delivered, avgLatency, connections };
  }, [servers]);

  function simulateBurst(customSize = burstSize) {
    const payloads = Array.from({ length: customSize }, (_, index) => createPayload(sequence + index));
    const { nextServers, routed } = routePayloads(strategy, servers, payloads, cursorRef);
    setSequence((value) => value + customSize);
    setServers(nextServers);
    setRouteOrder(routed.map((route) => ({
      target: route.targetId.replace('Server-', ''),
      key: route.payload.key,
      type: route.payload.type
    })));
    setEvents((current) => [
      ...routed.slice(-8).map((route) => ({
        id: `${route.payload.id}-${Date.now()}`,
        text: `${route.payload.id} [key: ${route.payload.key}, type: ${route.payload.type}] -> ${route.targetId} (${route.status}${route.roundTrip ? `, ${route.roundTrip}ms` : ''})`
      })),
      ...current
    ].slice(0, 28));
  }

  function coolDown() {
    setServers((current) => current.map((server) => ({
      ...server,
      connections: Math.max(0, Math.round(server.connections * 0.72 - server.weight * 3)),
      cpu: Math.max(18, Math.round(server.cpu * 0.82)),
      queue: Math.max(0, Math.round(server.queue * 0.55)),
      latency: Math.max(8, Math.round(server.latency * 0.86)),
      isolated: false
    })));
  }

  function toggleOnline(id) {
    setServers((current) => current.map((server) => (
      server.id === id
        ? { ...server, online: !server.online, isolated: false, connections: server.online ? 0 : server.connections }
        : server
    )));
    setEvents((current) => [{ id: `event-${Date.now()}`, text: `${id} ${servers.find((server) => server.id === id)?.online ? 'went offline: traffic redistributed instantly' : 'rejoined the pool'}` }, ...current].slice(0, 28));
  }

  function triggerPeakLoad() {
    setServers((current) => current.map((server) => (
      server.id === 'Server-C'
        ? { ...server, cpu: 94, connections: 168, queue: 28, latency: 91, peakLoad: true, isolated: true }
        : server
    )));
    setStrategy('least-connections');
    setEvents((current) => [{ id: `event-${Date.now()}`, text: 'Server-C exceeded CPU 90% / 150 connections and was isolated; Least Connections fallback active' }, ...current].slice(0, 28));
  }

  function resetCluster() {
    cursorRef.current = { rr: 0, wrr: 0 };
    setServers(INITIAL_SERVERS.map((server) => ({
      ...server,
      responseWindow: [...server.responseWindow],
      smooth: 0,
      isolated: false,
      peakLoad: false
    })));
    setEvents([{ id: `event-${Date.now()}`, text: 'Cluster reset: all nodes are online and eligible for routing' }]);
    setRouteOrder([]);
    setSequence(1);
    setAutoRun(false);
  }

  useEffect(() => {
    if (!autoRun) return undefined;
    const interval = window.setInterval(() => simulateBurst(Math.max(4, Math.round(burstSize / 3))), 1200);
    return () => window.clearInterval(interval);
  }, [autoRun, burstSize, strategy, servers, sequence]);

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Distributed Systems Frontend Proxy</p>
          <h1>Adaptive Load Balancer Dispatcher</h1>
          <p className="subcopy">
            Routes outbox payloads across live replication nodes, reacts to offline failures,
            isolates overloaded nodes, and updates routing metrics in real time.
          </p>
        </div>
        <div className="control-panel">
          <label>
            Strategy
            <select value={strategy} onChange={(event) => setStrategy(event.target.value)}>
              {STRATEGIES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            Burst size
            <input
              type="range"
              min="4"
              max="60"
              value={burstSize}
              onChange={(event) => setBurstSize(Number(event.target.value))}
            />
            <span>{burstSize} payloads</span>
          </label>
          <div className="button-row">
            <button type="button" onClick={() => simulateBurst()}>Simulate Burst</button>
            <button type="button" className={autoRun ? 'active' : ''} onClick={() => setAutoRun((value) => !value)}>
              {autoRun ? 'Auto Running' : 'Auto Paused'}
            </button>
            <button type="button" onClick={triggerPeakLoad}>Peak Load C</button>
            <button type="button" onClick={coolDown}>Cool Down</button>
            <button type="button" onClick={resetCluster}>Reset Cluster</button>
          </div>
        </div>
      </section>

      {(offlineCount > 0 || isolatedServers.length > 0) && (
        <section className="banner">
          <strong>High-contrast status:</strong>
          {offlineCount > 0 && <span>{offlineCount} offline node exception(s), payloads redistributed.</span>}
          {isolatedServers.length > 0 && <span>{isolatedServers.map((server) => server.id).join(', ')} isolated due to overload.</span>}
        </section>
      )}

      <section className="metrics">
        <div><span>Total routed</span><strong>{totals.delivered}</strong></div>
        <div><span>Active nodes</span><strong>{activeCount}/4</strong></div>
        <div><span>Total connections</span><strong>{totals.connections}</strong></div>
        <div><span>Sliding avg latency</span><strong>{totals.avgLatency}ms</strong></div>
      </section>

      <section className="latency-note">
        <strong>Live response policy check:</strong>
        <span>Server-B {serverBAvg.toFixed(1)}ms vs. Server-A {serverAAvg.toFixed(1)}ms. Latency and performance policies prioritize the lower sliding round-trip window.</span>
      </section>

      {routeOrder.length > 0 && (
        <section className="route-order">
          <strong>Last burst route order</strong>
          <div>
            {routeOrder.map((route, index) => (
              <span
                key={`${route.target}-${route.key}-${index}`}
                title={`${route.key} / ${route.type} -> Server-${route.target}`}
              >
                {route.target}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="server-grid">
        {servers.map((server) => {
          const avg = average(server.responseWindow);
          const danger = !server.online || server.isolated || shouldIsolate(server);
          return (
            <article className={`server-card ${danger ? 'danger' : ''}`} key={server.id}>
              <div className="server-top">
                <div>
                  <h2>{server.id}</h2>
                  <p>{server.region} / weight {server.weight}</p>
                </div>
                <button type="button" onClick={() => toggleOnline(server.id)}>
                  {server.online ? 'Online' : 'Offline'}
                </button>
              </div>
              <div className="bars">
                <Metric label="CPU" value={server.cpu} suffix="%" max={100} />
                <Metric label="Connections" value={server.connections} max={180} />
                <Metric label="Queue" value={server.queue} max={40} />
                <Metric label="Avg RTT" value={avg.toFixed(1)} suffix="ms" max={110} />
                <Metric label="Last burst" value={server.lastBurst} max={burstSize} />
                <Metric label="Mesh score" value={server.meshScore} max={100} />
              </div>
              <div className="server-footer">
                <span>{server.handled} handled</span>
                <span>mesh {server.meshScore}</span>
                <span>{server.isolated ? 'isolated' : server.online ? 'eligible' : 'removed'}</span>
              </div>
            </article>
          );
        })}
      </section>

      <section className="event-panel">
        <h2>Outbox Dispatch Stream</h2>
        <div className="event-list">
          {events.map((event) => <p key={event.id}>{event.text}</p>)}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, suffix = '', max }) {
  const percent = Math.min(100, Math.round((Number(value) / max) * 100));
  return (
    <div className="metric-row">
      <div>
        <span>{label}</span>
        <strong>{value}{suffix}</strong>
      </div>
      <div className="track"><span style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
