import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const [base,image]=process.argv.slice(2);
assert.match(base,/^evoapicloud\/evolution-api@sha256:[a-f0-9]{64}$/);
assert.match(image,/^[a-z0-9./:_-]+$/);
function docker(args){const r=spawnSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:128*1024*1024});if(r.status!==0)throw Error('DOCKER_VERIFICATION_FAILED:'+args[0]+':'+(r.error?.code??r.status)+':'+r.stderr?.slice(-2500));return r.stdout;}
const b=JSON.parse(docker(['image','inspect',base]))[0],c=JSON.parse(docker(['image','inspect',image]))[0];
const fields=['Entrypoint','Cmd','User','WorkingDir','ExposedPorts','Env','Volumes','Healthcheck','StopSignal'];
for(const field of fields)assert.deepEqual(c.Config[field],b.Config[field],'startup/config drift: '+field);
const script=fs.readFileSync(new URL('./manifest.mjs',import.meta.url),'utf8');
const manifest=tag=>JSON.parse(docker(['run','--rm','--network','none','--entrypoint','node',tag,'-e',script]));
const before=manifest(base),after=manifest(image);assert.deepEqual(Object.keys(after),Object.keys(before));
const changed=Object.keys(before).filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]));
assert.deepEqual(changed,['node_modules/baileys/lib/Socket/messages-recv.js']);
assert.equal(before[changed[0]].sha256,'8b9329ddf95fa7a1785826d8861af236f5f055ff22a5ed1ce52afdf9565d873e');
assert.equal(after[changed[0]].sha256,'1117b1ee04314684d5706c5d11d167f7ed8be09f7307a83e30ce4a131c748e1e');
console.log('IMAGE_FILE_AND_CONTRACT_PROOF '+JSON.stringify({platform:c.Os+'/'+c.Architecture,appFilesCompared:Object.keys(before).length,changed,fieldsPreserved:fields,baseImageId:b.Id,candidateImageId:c.Id}));
