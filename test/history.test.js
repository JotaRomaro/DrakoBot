import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationFlags } from 'discord.js';
import { fetchHistory, formatMessage, splitTranscript, saveTranscript, hasMessageContent } from '../src/history.js';
import { closeTicket } from '../src/closing.js';
import { parseTopic } from '../src/domain.js';

test('exportação percorre todas as páginas, ignora o cache e ordena IDs grandes',async()=>{
  const ids = ['123456789012345678','123456789012345679','123456789012345680'];
  const pages = [new Map([[ids[2],{id:ids[2]}],[ids[1],{id:ids[1]}]]),new Map([[ids[0],{id:ids[0]}]]),new Map()];
  const calls = [];
  const channel = {messages:{fetch:async options=>{calls.push(options);return pages.shift();}}};
  assert.deepEqual((await fetchHistory(channel)).map(m=>m.id),ids);
  assert.equal(calls[1].before,ids[1]);
  assert.equal(calls[2].before,ids[0]);
  assert.ok(calls.every(c=>c.cache===false && c.limit===100));
});

test('paginação repetida e falha de leitura não geram uma conversa parcial',async()=>{
  await assert.rejects(fetchHistory({messages:{fetch:async()=>new Map([['123',{id:'123'}]])}}),/percorrer/);
  await assert.rejects(fetchHistory({messages:{fetch:async()=>{throw new Error('Sem acesso');}}}),/Sem acesso/);
});

test('TXT inclui autoria, datas, edição, embeds, anexos e resposta',()=>{
  const text = formatMessage({id:'123',createdTimestamp:0,editedTimestamp:1000,author:{tag:'Cliente',id:'456'},content:'Olá 👋',embeds:[{title:'VIP',description:'Benefícios',fields:[{name:'Valor',value:'R$ 10'}]}],attachments:new Map([['1',{name:'foto.png',url:'https://example.com/foto'}]]),stickers:[{name:'Oi'}],reference:{messageId:'122'}});
  for (const part of ['1970-01-01','Cliente (456)','Olá 👋','Editada em:','VIP','Benefícios','Valor: R$ 10','foto.png','https://example.com/foto','Sticker: Oi','122']) assert.ok(text.includes(part),part);
});

test('partes do TXT respeitam bytes e preservam emojis e acentos',()=>{
  const text = 'Olá 👋! '.repeat(100);
  const chunks = splitTranscript(text,31);
  assert.ok(chunks.length>1);
  assert.ok(chunks.every(c=>c.length<=31));
  assert.equal(chunks.map(c=>c.toString('utf8')).join(''),text);
  assert.throws(()=>splitTranscript(text,1),/limite/);
});

test('aceita as duas flags de conteúdo e não exporta sem acesso ao texto',async()=>{
  for (const enabled of [ApplicationFlags.GatewayMessageContent,ApplicationFlags.GatewayMessageContentLimited]) {
    assert.equal(await hasMessageContent({application:{fetch:async()=>({flags:{has:flag=>flag===enabled}})}}),true);
  }
  let fetched = false;
  const channel = {client:{application:{fetch:async()=>({flags:{has:()=>false}})}},messages:{fetch:async()=>{fetched=true;}}};
  await assert.rejects(saveTranscript(channel,{},'123'),/Message Content Intent/);
  assert.equal(fetched,false);
});

function fakeChannel() {
  const calls = [];
  return {id:'123456789012345678',calls,
    delete:async()=>{calls.push('delete');},
    permissionOverwrites:{edit:async(owner,permissions)=>{calls.push({owner,permissions});}},
    setTopic:async topic=>{calls.push(parseTopic(topic));},
    setName:async name=>{calls.push(name);},
    send:async()=>{calls.push('send');}
  };
}
const newTicket = ()=>({owner:'123456789012345679',status:'open',category:'ajuda',payment:'none'});

test('exclui o canal somente depois do TXT salvo, mesmo se envio ao Discord falhar',async()=>{
  for (const delivered of [true,false]) {
    const channel = fakeChannel();
    let details;
    const result = await closeTicket(channel,newTicket(),'111',{
      save:async()=>{channel.calls.push('saved');return {messageCount:5,delivered};},
      log:async(action,c,t,a,text)=>{details=text;}
    });
    assert.equal(result.archived,false);
    assert.deepEqual(channel.calls,['saved','delete']);
    assert.match(details,/5 mensagens/);
    assert.ok(details.includes(delivered ? 'enviado' : 'apenas na pasta local'));
  }
});

test('falha no TXT finaliza e arquiva, oculta do titular e nunca exclui mensagens',async()=>{
  const channel = fakeChannel();
  const ticket = newTicket();
  const result = await closeTicket(channel,ticket,'111',{
    save:async()=>{throw new Error('Message Content Intent não habilitado');},
    log:async()=>{}
  });
  assert.equal(result.archived,true);
  assert.equal(ticket.status,'closed');
  assert.equal(channel.calls.includes('delete'),false);
  assert.deepEqual(channel.calls[0],{owner:ticket.owner,permissions:{ViewChannel:false,SendMessages:false}});
  assert.equal(channel.calls[1].status,'closed');
  assert.ok(channel.calls.some(c=>typeof c==='string' && c.startsWith('arquivado-')));
});

test('falha ao excluir canal não registra encerramento concluído',async()=>{
  const channel = fakeChannel();
  channel.delete = async()=>{throw new Error('Sem permissão');};
  let logged=false;
  await assert.rejects(closeTicket(channel,newTicket(),'111',{
    save:async()=>({messageCount:1,delivered:true}),
    log:async()=>{logged=true;}
  }),/Sem permissão/);
  assert.equal(logged,false);
});
