import test from 'node:test';
import assert from 'node:assert/strict';
import {topicOf,parseTopic,isStaff,withLock} from '../src/domain.js';
const ticket={owner:'123456789012345678',status:'open',category:'vip',payment:'review'};

test('qualquer cargo configurado autoriza a equipe, sem autorizar outros cargos',()=>{
  for (const role of ['suporte1','suporte2','vip']) {
    const member={permissions:{has:()=>false},roles:{cache:new Map([[role,{}]])}};
    assert.equal(isStaff(member,['suporte1','suporte2']),role!=='vip');
  }
});
test('o estado do pagamento e o titular sobrevivem à serialização',()=>assert.deepEqual(parseTopic(topicOf(ticket)),ticket));
test('canais comuns e metadados corrompidos não são tratados como tickets',()=>{
  for (const topic of [null,'canal de suporte','ticket-v1:{','ticket-v1:{}',topicOf({...ticket,owner:'abc'}),topicOf({...ticket,payment:'invalid'})]) assert.equal(parseTopic(topic),null);
});
test('membro comum e comprador VIP não recebem autorização de equipe',()=>{
  const member={permissions:{has:()=>false},roles:{cache:new Map([['vip',{}]])}};
  assert.equal(isStaff(member,'equipe'),false);
  member.roles.cache.set('equipe',{});
  assert.equal(isStaff(member,'equipe'),true);
});
test('administradores podem conferir pagamentos sem o cargo de equipe',()=>assert.equal(isStaff({permissions:{has:bit=>bit===8n},roles:{cache:new Map()}},'equipe'),true));
test('duas ações simultâneas no mesmo ticket não entram juntas',async()=>{
  const locks=new Set(); let release;
  const first=withLock(locks,'ticket',()=>new Promise(resolve=>{release=resolve;}));
  await assert.rejects(withLock(locks,'ticket',async()=>assert.fail('não deveria entrar')),/andamento/);
  release(); await first;
  assert.equal(locks.size,0);
});
test('falhas liberam o bloqueio para uma nova tentativa',async()=>{
  const locks=new Set();
  await assert.rejects(withLock(locks,'ticket',async()=>{throw new Error('falhou');}),/falhou/);
  assert.equal(await withLock(locks,'ticket',async()=>42),42);
});
