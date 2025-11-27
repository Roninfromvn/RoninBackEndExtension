// src/metrics/metrics.js - Runtime metrics singleton
class Metrics {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.reporterInterval = null;
  }

  inc(name, value = 1, labels = {}) {
    const key = this._makeKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
  }

  observe(name, value, labels = {}) {
    const key = this._makeKey(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    this.histograms.get(key).push(value);
    
    // Giữ tối đa 1000 giá trị để tránh memory leak
    if (this.histograms.get(key).length > 1000) {
      this.histograms.set(key, this.histograms.get(key).slice(-1000));
    }
  }

  set(name, value, labels = {}) {
    const key = this._makeKey(name, labels);
    this.gauges.set(key, value);
  }

  _makeKey(name, labels) {
    const labelStr = Object.keys(labels).length > 0 
      ? ':' + Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(',')
      : '';
    return name + labelStr;
  }

  _calculatePercentile(values, p) {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  snapshot() {
    const result = {
      counters: {},
      gauges: {},
      histograms: {}
    };

    // Counters
    for (const [key, value] of this.counters) {
      result.counters[key] = value;
    }

    // Gauges
    for (const [key, value] of this.gauges) {
      result.gauges[key] = value;
    }

    // Histograms với percentiles
    for (const [key, values] of this.histograms) {
      if (values.length > 0) {
        result.histograms[key] = {
          count: values.length,
          sum: values.reduce((a, b) => a + b, 0),
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          p50: this._calculatePercentile(values, 50),
          p95: this._calculatePercentile(values, 95),
          p99: this._calculatePercentile(values, 99)
        };
      }
    }

    return result;
  }

  startReporter() {
    if (process.env.METRICS !== '1') return;
    
    this.reporterInterval = setInterval(() => {
      const snapshot = this.snapshot();
      const now = new Date().toLocaleTimeString();
      
      // Workers
      const workersAlive = snapshot.gauges['workers.alive'] || 0;
      const workersConfigured = snapshot.gauges['workers.configured'] || 0;
      
      // Jobs
      const jobsStarted = snapshot.counters['jobs.started'] || 0;
      const jobsSucceeded = snapshot.counters['jobs.succeeded'] || 0;
      const jobsFailed = snapshot.counters['jobs.failed'] || 0;
      
      // Latency & Duration
      const latP50 = snapshot.histograms['job.latency_ms']?.p50 || 0;
      const latP95 = snapshot.histograms['job.latency_ms']?.p95 || 0;
      const latP99 = snapshot.histograms['job.latency_ms']?.p99 || 0;
      const durP50 = snapshot.histograms['job.duration_ms']?.p50 || 0;
      const durP95 = snapshot.histograms['job.duration_ms']?.p95 || 0;
      const durP99 = snapshot.histograms['job.duration_ms']?.p99 || 0;
      
      // Media
      const photoCount = snapshot.counters['media.photo.count'] || 0;
      const videoCount = snapshot.counters['media.video.count'] || 0;
      
      // Memory
      const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
      
      console.log(`[METRICS] t=${now} workers alive=${workersAlive}/${workersConfigured} | started=${jobsStarted} ok=${jobsSucceeded} fail=${jobsFailed} | p50/95/99(lat_ms)=${Math.round(latP50)}/${Math.round(latP95)}/${Math.round(latP99)} p50/95/99(dur_ms)=${Math.round(durP50)}/${Math.round(durP95)}/${Math.round(durP99)} | photo=${photoCount} video=${videoCount} | rss=${rssMB}MB`);
    }, 60000); // 60 seconds
  }

  stopReporter() {
    if (this.reporterInterval) {
      clearInterval(this.reporterInterval);
      this.reporterInterval = null;
    }
  }
}

// Singleton instance
const metrics = new Metrics();

module.exports = metrics;
