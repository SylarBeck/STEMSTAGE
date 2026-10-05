// Shrinks the baked band models (tools/mpfb/build_band.py) for shipping: quantized, meshopt-compressed geometry
// (three.js decodes it with MeshoptDecoder). The body's _HIDE bitmask stays a plain float, since quantizing it would
// scramble the bits. Usage: node tools/mpfb/pack.mjs public/models/band-m.glb [more.glb ...]  (rewrites in place)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

for (const file of process.argv.slice(2)) {
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true, keepExtras: true }),
    weld(),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({
      pattern: /^(POSITION|NORMAL|TEXCOORD_\d+|WEIGHTS_\d+|JOINTS_\d+)$/,
      quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8,
    }),
  );
  doc.createExtension((await import('@gltf-transform/extensions')).EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: 'filter' });
  await io.write(file, doc);
  console.log(file, (before / 1e6).toFixed(1), 'MB ->', (fs.statSync(file).size / 1e6).toFixed(1), 'MB');
}
