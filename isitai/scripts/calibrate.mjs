#!/usr/bin/env node
// CLI entry for the weekly recalibration job (systemd timer / GitHub Actions /
// Modal cron). Run inside the Next.js project root so DATA_DIR resolves the
// same way as the server:   node scripts/calibrate.mjs
import { runCalibration } from '../lib/calibrationJob.js'

runCalibration({ force: true })
  .then(cal => {
    console.log(JSON.stringify(cal, null, 2))
    process.exit(0)
  })
  .catch(err => { console.error('Calibration failed:', err); process.exit(1) })
