export class Histogram {
  private bins = new Uint32Array(5001);
  count = 0;
  over50 = 0;
  add(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    const index = Math.min(5000, Math.round(ms * 10));
    this.bins[index] = (this.bins[index] ?? 0) + 1;
    this.count++;
    if (ms > 50) this.over50++;
  }
  percentile(fraction: number): number | null {
    if (!this.count) return null;
    const target = Math.max(1, Math.ceil(this.count * fraction));
    let seen = 0;
    for (let i = 0; i < this.bins.length; i++) {
      seen += this.bins[i] ?? 0;
      if (seen >= target) return i / 10;
    }
    return 500;
  }
  summary() {
    return {
      samples: this.count,
      p50Ms: this.percentile(0.5),
      p95Ms: this.percentile(0.95),
      p99Ms: this.percentile(0.99),
      over50Ms: this.over50,
    };
  }
}

export function gpuTimer(gl: WebGL2RenderingContext) {
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const pending: WebGLQuery[] = [];
  let current: WebGLQuery | null = null;
  const histogram = new Histogram();
  return {
    histogram,
    supported: Boolean(ext),
    begin(measuring: boolean) {
      if (!ext) return;
      while (pending.length) {
        const query = pending[0];
        if (!query || !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
        pending.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT))
          histogram.add(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(query);
      }
      if (measuring && pending.length < 4) {
        current = gl.createQuery();
        if (current) gl.beginQuery(ext.TIME_ELAPSED_EXT, current);
      }
    },
    end() {
      if (ext && current) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(current);
        current = null;
      }
    },
    dispose() {
      for (const query of pending) gl.deleteQuery(query);
      pending.length = 0;
    },
  };
}
