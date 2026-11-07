// Stress Lab solver thread: runs the voxel FEA off the page so the 3D view stays smooth.
// Message in:  { grid, E, nu, fixed, loads, body, tol, maxIter, fail: { strengthXY, strengthZ, axis, factor } }
// Messages out: { progress: { iter, residual } } ... then { result } or { error }
import { solve, failure, cellDisp } from '/shared/lab/fea.js';

self.onmessage = (e) => {
  const job = e.data;
  try {
    const t0 = performance.now();
    const res = solve(job.grid, { ...job, onProgress: (iter, residual) => self.postMessage({ progress: { iter, residual } }) });
    const fail = failure(job.grid, res, job.fail);
    const n = job.grid.nx * job.grid.ny * job.grid.nz;
    const disp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      if (!job.grid.solid[i] || res.nodeOf[i * 8] < 0) continue;
      const d = cellDisp(res, i);
      disp[i * 3] = d[0]; disp[i * 3 + 1] = d[1]; disp[i * 3 + 2] = d[2];
    }
    const out = {
      vm: res.vm, stress: res.stress, sf: fail.sf, fi: fail.fi, across: fail.across, disp,
      maxDisp: res.maxDisp, iterations: res.iterations, residual: res.residual, converged: res.converged,
      dofs: res.dofs, solidCells: res.solidCells, anyFixed: res.anyFixed, ms: performance.now() - t0,
    };
    self.postMessage({ result: out }, [out.vm.buffer, out.stress.buffer, out.sf.buffer, out.fi.buffer, out.across.buffer, out.disp.buffer]);
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
