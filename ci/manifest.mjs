import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root='/evolution';
const entries={};
function scan(dir){
 for(const name of fs.readdirSync(dir).sort()){
  const file=path.join(dir,name),stat=fs.lstatSync(file),rel=path.relative(root,file);
  if(stat.isSymbolicLink())entries[rel]={type:'link',target:fs.readlinkSync(file)};
  else if(stat.isDirectory())scan(file);
  else if(stat.isFile())entries[rel]={type:'file',mode:stat.mode&0o777,bytes:stat.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
  else throw Error('UNEXPECTED_IMAGE_FILE_TYPE');
 }
}
scan(root);process.stdout.write(JSON.stringify(entries));
