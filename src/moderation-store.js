import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { withLock } from './domain.js';

export function createModerationStore(root = new URL('../data/moderation/',import.meta.url)) {
  const locks = new Set();
  function file(key) {
    if (!/^[a-z]+-\d{17,20}-\d{17,20}$/.test(key)) throw new Error('Identificador de moderação inválido.');
    return new URL(key+'.json',root);
  }
  async function read(key) {
    try { return JSON.parse(await readFile(file(key),'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function update(key, change) {
    return withLock(locks,key,async()=>{
      const next = await change(await read(key));
      await mkdir(root,{recursive:true});
      const target = file(key);
      const temporary = new URL(target.href+'.tmp');
      await writeFile(temporary,JSON.stringify(next,null,2),'utf8');
      await rename(temporary,target);
      return next;
    });
  }
  async function audit(event) {
    try {
      await mkdir(root,{recursive:true});
      await appendFile(new URL('events.jsonl',root),JSON.stringify({time:new Date().toISOString(),...event})+'\n');
    } catch (error) { console.error('Falha no registro de moderação: '+(error.code || error.name)); }
  }
  return {read,update,audit};
}

export const moderationStore = createModerationStore();
