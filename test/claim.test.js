import test from 'node:test';
import assert from 'node:assert/strict';
import { claimTicket, topicOf, parseTopic, withLock } from '../src/domain.js';

const ticket = {owner:'123456789012345678',status:'open',category:'ajuda',payment:'none'};
test('somente equipe assume; responsável persiste e não pode ser substituído',()=>{
  assert.throws(()=>claimTicket(ticket,'111111111111111111',false),/Somente a equipe/);
  const claimed = claimTicket(ticket,'111111111111111111',true);
  assert.deepEqual(parseTopic(topicOf(claimed)),claimed);
  assert.equal(ticket.assignee,undefined);
  assert.throws(()=>claimTicket(claimed,'111111111111111111',true),/Você já/);
  assert.throws(()=>claimTicket(claimed,'222222222222222222',true),/já foi assumido/);
});
test('duas pessoas tentando assumir deixam apenas um responsável',async()=>{
  const locks = new Set();
  let current = ticket;
  const results = await Promise.allSettled(['111111111111111111','222222222222222222'].map(id=>withLock(locks,'ticket',async()=>{
    await Promise.resolve();
    current = claimTicket(current,id,true);
  })));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(current.assignee,'111111111111111111');
});
