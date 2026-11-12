import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, Events, PermissionFlagsBits as P, ActionRow, ChannelType } from 'discord.js';
import { topicOf, parseTopic } from '../src/domain.js';

// Carregue o handler real sem conectar ao Discord ou executar ações no servidor.
const ids={owner:'123456789012345671',staff:'123456789012345672',guild:'123456789012345673',support:'123456789012345674',vip:'123456789012345675',category:'123456789012345676',channel:'123456789012345677'};
Object.assign(process.env,{DISCORD_TOKEN:'token-de-teste',CLIENT_ID:'123456789012345678',GUILD_ID:ids.guild,SUPPORT_ROLE_ID:ids.support,VIP_ROLE_ID:ids.vip,TICKET_CATEGORY_ID:ids.category});
let client, botModule;
const login=Client.prototype.login;
Client.prototype.login=function(){client=this;return Promise.resolve('teste');};
try { botModule = await import('../src/bot.js'); }
finally { Client.prototype.login=login; }
const handle=client.listeners(Events.InteractionCreate)[0];
const { config } = await import('../src/settings.js');

function interaction(customId,{userId=ids.owner,admin=false,support=false}={}) {
  const replies=[],mutations=[];
  const member={permissions:{has:permission=>admin && permission===P.Administrator},roles:{cache:new Map(support ? [[ids.support,{}]] : [])}};
  const channel={topic:topicOf({owner:ids.owner,status:'open',category:'ajuda',payment:'none'}),parentId:ids.category,
    delete:async()=>mutations.push('delete'),setTopic:async()=>mutations.push('topic'),send:async()=>mutations.push('send')};
  const i={customId,channelId:ids.channel,guildId:ids.guild,user:{id:userId},channel,
    guild:{channels:{fetch:async()=>channel},members:{fetch:async options=>{assert.deepEqual(options,{user:userId,force:true});return member;}}},
    inGuild:()=>true,isChatInputCommand:()=>false,isButton:()=>true,isStringSelectMenu:()=>false,
    deferReply:async()=>{i.deferred=true;},editReply:async reply=>replies.push(reply)};
  return {i,replies,mutations,member};
}

test('titular e equipe sem Administrador não abrem nem confirmam encerramento',async()=>{
  for (const customId of ['ticket:close','ticket:close-confirm']) {
    for (const options of [{userId:ids.owner},{userId:ids.staff,support:true}]) {
      const f=interaction(customId,options);
      await handle(f.i);
      assert.equal(f.replies.at(-1).content,'Apenas adm/staff podem finalizar o ticket');
      assert.deepEqual(f.mutations,[]);
    }
  }
});

test('Administrador consegue abrir a confirmação sem depender do cargo de atendimento',async()=>{
  const f=interaction('ticket:close',{userId:ids.staff,admin:true});
  await handle(f.i);
  assert.equal(f.replies.at(-1).components[0].toJSON().components[0].custom_id,'ticket:close-confirm');
  assert.deepEqual(f.mutations,[]);
});

test('confirmação antiga deixa de funcionar após perder Administrador',async()=>{
  const f=interaction('ticket:close',{admin:true});
  await handle(f.i);
  assert.ok(f.replies.at(-1).components);
  f.member.permissions.has=()=>false;
  f.i.customId='ticket:close-confirm';
  await handle(f.i);
  assert.equal(f.replies.at(-1).content,'Apenas adm/staff podem finalizar o ticket');
  assert.deepEqual(f.mutations,[]);
});

const buttonIds = payload=>payload.components.flatMap(row=>row.toJSON().components.map(button=>button.custom_id));
const purchaseTicket = ()=>({owner:ids.owner,status:'open',category:'vip',payment:'none'});
const vipCategory = config.categories.find(c=>c.id==='vip');

function paymentInteraction() {
  const f=interaction('ticket:paid');
  const ticket=purchaseTicket();
  const payload=botModule.categoryContent(vipCategory,ticket);
  const sends=[],edits=[],topics=[],logs=[];
  f.i.message={components:payload.components.map(row=>new ActionRow(row.toJSON())),edit:async payload=>edits.push(payload)};
  f.i.channel.setTopic=async topic=>topics.push(parseTopic(topic));
  f.i.channel.send=async()=>assert.fail('O cartão de conferência não pode ser enviado no ticket do cliente');
  return {...f,ticket,sends,edits,topics,logs,log:async(...args)=>logs.push(args),sendReview:async payload=>sends.push(payload)};
}

test('Já paguei aparece em compras mesmo sem chave Pix e nunca aparece em suporte',()=>{
  const key=config.vip.pixKey;
  try {
    config.vip.pixKey='';
    assert.ok(buttonIds(botModule.categoryContent(vipCategory,purchaseTicket())).includes('ticket:paid'));
    const support=config.categories.find(c=>c.id!=='vip');
    assert.equal(buttonIds(botModule.categoryContent(support,{...purchaseTicket(),category:support.id})).includes('ticket:paid'),false);
  } finally { config.vip.pixKey=key; }
});

test('Já paguei solicita conferência, desativa o botão e preserva os outros controles',async()=>{
  const f=paymentInteraction();
  await botModule.markPaid(f.i,f.ticket,f.log,f.sendReview);
  assert.equal(f.ticket.payment,'review');
  assert.equal(f.topics.at(-1).payment,'review');
  assert.equal(f.sends.length,1);
  assert.deepEqual(buttonIds(f.sends[0]),['ticket:approve:'+ids.channel,'ticket:reject:'+ids.channel]);
  assert.deepEqual(f.sends[0].allowedMentions,{parse:[]});
  assert.equal(JSON.stringify(f.sends[0]).includes('<@'),false);
  assert.deepEqual(buttonIds(f.edits[0]),['ticket:paid','ticket:claim','ticket:close']);
  assert.equal(f.edits[0].components[0].toJSON().components[0].disabled,true);
  assert.equal(f.logs.length,1);
  assert.match(f.replies.at(-1),/comprovante/);
});

test('outro membro, ticket de suporte e pagamento já informado não disparam nova solicitação',async()=>{
  for (const scenario of ['other','support','review','approved']) {
    const f=paymentInteraction();
    if (scenario==='other') f.i.user.id=ids.staff;
    if (scenario==='support') f.ticket.category='ajuda';
    if (scenario==='review' || scenario==='approved') f.ticket.payment=scenario;
    await assert.rejects(botModule.markPaid(f.i,f.ticket,f.log,f.sendReview));
    assert.deepEqual(f.sends,[]);
    assert.deepEqual(f.topics,[]);
    assert.deepEqual(f.logs,[]);
  }
});

test('falha ao avisar a equipe libera uma nova tentativa de Já paguei',async()=>{
  const f=paymentInteraction();
  f.sendReview=async()=>{throw new Error('Falha no envio');};
  await assert.rejects(botModule.markPaid(f.i,f.ticket,f.log,f.sendReview),/Falha no envio/);
  assert.equal(f.ticket.payment,'none');
  assert.deepEqual(f.topics.map(t=>t.payment),['review','none']);
  assert.deepEqual(f.edits,[]);
});

test('ticket de compras inclui QR Code e Copia e Cola com cidade configurada',async()=>{
  const before={...config.vip};
  try {
    Object.assign(config.vip,{pixKey:'123e4567-e12b-12d1-a456-426655440000',price:'R$ 29,90',receiverName:'Teste',receiverCity:'São Paulo'});
    const payload=await botModule.ticketContent(vipCategory,purchaseTicket(),ids.channel);
    assert.equal(payload.files[0].name,'pix.png');
    const vip=payload.embeds[1].toJSON();
    assert.equal(vip.image.url,'attachment://pix.png');
    assert.ok(vip.fields.some(f=>f.name.includes('Copia e Cola') && f.value.includes('000201')));
    assert.ok(buttonIds(payload).includes('ticket:paid'));
    config.vip.receiverCity='';
    assert.equal((await botModule.ticketContent(vipCategory,purchaseTicket(),ids.channel)).files,undefined);
  } finally { Object.assign(config.vip,before); }
});

function staffReviewInteraction(action,options={}) {
  const f=interaction('ticket:'+action+':'+ids.channel,{userId:ids.staff,support:true,...options});
  const original=f.i.channel;
  original.id=ids.channel;
  original.topic=topicOf({...purchaseTicket(),payment:'review'});
  const sent=[],edited=[],granted=[],logs=[];
  original.setTopic=async topic=>{original.topic=topic;};
  original.send=async payload=>sent.push(payload);
  f.i.channelId='123456789012345679';
  f.i.channel={id:f.i.channelId,send:async()=>assert.fail('A decisão deve ser aplicada ao ticket original'),setTopic:async()=>assert.fail('Não pode alterar o tópico do canal de logs')};
  f.i.message={edit:async payload=>edited.push(payload)};
  const currentActorFetch=f.i.guild.members.fetch;
  const vip={id:ids.vip,position:1,managed:false,permissions:{has:()=>false}};
  f.i.guild.roles={fetch:async()=>new Map([[ids.support,{id:ids.support,managed:false}],[ids.vip,vip]])};
  f.i.guild.channels.fetch=async id=>id===ids.category ? {type:ChannelType.GuildCategory,permissionsFor:()=>({has:()=>true})} : original;
  f.i.guild.members.fetchMe=async()=>({roles:{highest:{id:'bot-role',position:2}},permissions:{has:()=>true}});
  f.i.guild.members.fetch=async arg=>typeof arg==='string' && arg===ids.owner ? {roles:{add:async(role,reason)=>granted.push({role,reason})}} : currentActorFetch(arg);
  return {...f,original,sent,edited,granted,logs,log:async(...args)=>logs.push(args)};
}

test('staff aprova pelo canal privado e libera VIP no ticket original uma única vez',async()=>{
  const f=staffReviewInteraction('approve');
  await botModule.handleTicket(f.i,f.log);
  assert.equal(f.granted.length,1);
  assert.equal(f.granted[0].role.id,ids.vip);
  assert.ok(f.granted[0].reason.includes(ids.channel));
  assert.equal(parseTopic(f.original.topic).payment,'approved');
  assert.equal(f.sent.length,1);
  assert.match(f.sent[0].embeds[0].toJSON().title,/VIP liberado/);
  assert.deepEqual(f.edited,[{components:[]}]);
  assert.equal(f.logs[0][1],f.original);
  await assert.rejects(botModule.handleTicket(f.i,f.log),/Não há um pagamento/);
  assert.equal(f.granted.length,1);
});

test('staff rejeita pelo canal privado e devolve Já paguei no ticket correto',async()=>{
  const f=staffReviewInteraction('reject');
  await botModule.handleTicket(f.i,f.log);
  assert.equal(parseTopic(f.original.topic).payment,'none');
  assert.deepEqual(buttonIds(f.sent[0]),['ticket:paid']);
  assert.deepEqual(f.edited,[{components:[]}]);
  assert.equal(f.logs[0][1],f.original);
});

test('titular sem cargo não confirma nem rejeita uma compra por botões privados',async()=>{
  for (const action of ['approve','reject']) {
    const f=staffReviewInteraction(action,{userId:ids.owner,support:false});
    await assert.rejects(botModule.handleTicket(f.i,f.log),/Somente a equipe/);
    assert.equal(parseTopic(f.original.topic).payment,'review');
    assert.deepEqual(f.sent,[]);
    assert.deepEqual(f.granted,[]);
    assert.deepEqual(f.edited,[]);
  }
});

test('migração move cartão antigo para a equipe antes de removê-lo do ticket',async()=>{
  const sequence=[];
  const channel={id:ids.channel,parentId:ids.category,topic:topicOf({...purchaseTicket(),payment:'review'})};
  const botId='123456789012345678';
  const old={author:{id:botId},components:[{components:[{customId:'ticket:approve'}]}],delete:async()=>sequence.push('remove')};
  const other={author:{id:ids.owner},components:old.components,delete:async()=>assert.fail('Não deve apagar mensagens do cliente')};
  await botModule.migratePaymentReviews({channels:{fetch:async()=>new Map([[channel.id,channel]])}},botId,async payload=>{
    sequence.push('private');
    assert.deepEqual(buttonIds(payload),['ticket:approve:'+ids.channel,'ticket:reject:'+ids.channel]);
    assert.deepEqual(payload.allowedMentions,{parse:[]});
  },async()=>[old,other]);
  assert.deepEqual(sequence,['private','remove']);
});
