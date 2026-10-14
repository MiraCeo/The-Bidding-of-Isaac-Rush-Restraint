import { buildRelease } from './build-release.mjs';
import {
  prepareDeployment,
  writeWorkflowOutputs,
} from './prepare-deployment.mjs';
try {
  await buildRelease();
  const result = await prepareDeployment({
    requireClean: process.argv.includes('--require-clean'),
  });
  await writeWorkflowOutputs(result, process.env.GITHUB_OUTPUT);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
