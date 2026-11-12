import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Collection, PermissionsBitField, PermissionFlagsBits as P, ChannelType } from 'discord.js';
import { commands, commandPermissions } from '../src/commands.js';
import { parseDuration, assertTarget, assertRole, handleModeration } from '../src/moderation.js';
import { createModerationStore } from '../src/moderation-store.js';

const ids={guild:'123456789012345670',actor:'123456789012345671',target:'123456789012345672',bot:'123456789012345673',channel:'123456789012345674',role:'123456789012345675',owner:'123456789012345676'};
const permissions = (...bits)=>new PermissionsBitField(bits);
const role = (position,extra={})=>({position,comparePositionTo(other){return position-other.position;},...extra});

test('todos os comandos serializam com permissões e somente no servidor',()=>{
  assert.equal(commands.length,18);
  assert.equal(new Set(commands.map(c=>c.name)).size,18);
  for (const command of commands) {
    const json=command.toJSON();
    assert.equal(json.dm_permission,false);
    assert.equal(json.default_member_permissions,String(commandPermissions[json.name]));
    const validateOrder=options=>{
      let optional=false;
      for (const option of options || []) {
        if (option.type===1) validateOrder(option.options);
        else { if (!option.required) optional=true; else assert.equal(optional,false,json.name+' tem opção obrigatória depois da opcional'); }
      }
    };
    validateOrder(json.options);
  }
});

test('timeout aceita unidades e limita a 28 dias',()=>{
  for (const [text,ms] of [['30s',30_000],['10m',600_000],['2H',7_200_000],['28d',2_419_200_000]]) assert.equal(parseDuration(text),ms);
  for (const text of ['0m','29d','-2h','1.5h','abc','999999999999999999999d','10']) assert.throws(()=>parseDuration(text));
});

test('nem administradores ignoram a hierarquia do executor; dono tem exceção',()=>{
  const guild={ownerId:ids.owner};
  const actor={id:ids.actor,roles:{highest:role(5)},permissions:permissions(P.Administrator)};
  assert.doesNotThrow(()=>assertTarget(actor,{id:ids.target,roles:{highest:role(4)}},guild,ids.bot));
  for (const position of [5,6]) assert.throws(()=>assertTarget(actor,{id:ids.target,roles:{highest:role(position)}},guild,ids.bot),/abaixo/);
  for (const id of [ids.actor,ids.owner,ids.bot]) assert.throws(()=>assertTarget(actor,{id,roles:{highest:role(1)}},guild,ids.bot));
  assert.doesNotThrow(()=>assertTarget({...actor,id:ids.owner},{id:ids.target,roles:{highest:role(10)}},guild,ids.bot));
});

test('cargos de integração, superiores e com privilégios extras são protegidos',()=>{
  const actor={id:ids.actor,permissions:permissions(P.ManageRoles),roles:{highest:role(5)}};
  const bot={roles:{highest:role(7)}};
  const guild={id:ids.guild,ownerId:ids.owner};
  const targetRole=role(3,{id:ids.role,managed:false,permissions:permissions()});
  assert.doesNotThrow(()=>assertRole(actor,bot,targetRole,guild));
  for (const override of [{id:ids.guild},{managed:true},{position:8},{position:5},{permissions:permissions(P.Administrator)}]) {
    assert.throws(()=>assertRole(actor,bot,{...targetRole,...override},guild));
  }
});

test('advertências e estado do bloqueio persistem entre instâncias do armazenamento',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'discord-moderation-test-'));
  const url=pathToFileURL(directory+sep);
  try {
    const first=createModerationStore(url);
    const key='warnings-'+ids.guild+'-'+ids.target;
    await first.update(key,()=>[{reason:'Primeira',actorId:ids.actor}]);
    const second=createModerationStore(url);
    await second.update(key,old=>[...old,{reason:'Segunda',actorId:ids.actor}]);
    assert.equal((await first.read(key)).length,2);
    const lockKey='lock-'+ids.guild+'-'+ids.channel;
    await first.update(lockKey,()=>({active:true,sendMessages:null}));
    assert.deepEqual(await second.read(lockKey),{active:true,sendMessages:null});
    await assert.rejects(first.read('../escape'),/inválido/);
    await assert.rejects(first.update(key,()=>{throw new Error('Falha');}),/Falha/);
    assert.equal((await first.read(key)).length,2);
  } finally {
    for (const filename of await readdir(directory)) await unlink(join(directory,filename));
    await rmdir(directory);
  }
});

function fixture(name,{actorPermissions=permissions(P.Administrator),botPermissions=permissions(P.Administrator)}={}) {
  const calls=[];
  const actor={id:ids.actor,roles:{highest:role(5)},permissions:actorPermissions};
  const bot={id:ids.bot,roles:{highest:role(6)},permissions:botPermissions};
  const target={id:ids.target,roles:{highest:role(1)},manageable:true,bannable:true,kickable:true,moderatable:true,
    ban:async options=>calls.push(['ban',options]),kick:async reason=>calls.push(['kick',reason]),
    timeout:async duration=>calls.push(['timeout',duration]),setNickname:async value=>calls.push(['nick',value])};
  const state=new Map();
  const store={read:async key=>state.get(key) ?? null,update:async(key,change)=>{const next=await change(state.get(key) ?? null);state.set(key,next);return next;},audit:async event=>calls.push(['audit',event])};
  const values={membro:{id:ids.target,username:'Cliente'},motivo:'Teste',tempo:'10m',id:ids.target,quantidade:3,segundos:10,apelido:'Novo'};
  const channel={id:ids.channel,type:ChannelType.GuildText,permissionsFor:member=>member.permissions,
    permissionOverwrites:{cache:new Collection(),edit:async(id,changes)=>calls.push(['overwrite',changes])},
    setRateLimitPerUser:async seconds=>calls.push(['slowmode',seconds])};
  const guild={id:ids.guild,ownerId:ids.owner,
    members:{fetch:async({user})=>user===ids.actor ? actor : target,fetchMe:async()=>bot},
    channels:{fetch:async()=>channel},bans:{remove:async id=>calls.push(['unban',id])}};
  const i={commandName:name,guild,guildId:ids.guild,channel,channelId:ids.channel,client:{user:{id:ids.bot}},user:{id:ids.actor},
    deferReply:async()=>{},editReply:async payload=>calls.push(['reply',payload]),
    options:{getString:key=>values[key] ?? null,getBoolean:key=>values[key] ?? null,getInteger:key=>values[key],getUser:key=>values[key],getSubcommand:()=>values.operation,getRole:()=>values.cargo,getChannel:()=>values.canal}};
  return {i,store,calls,values,actor,bot,target,channel,state};
}

test('permissão do comando é verificada novamente antes de qualquer punição',async()=>{
  const f=fixture('ban',{actorPermissions:permissions()});
  await assert.rejects(handleModeration(f.i,f.store),/Você não tem/);
  assert.equal(f.calls.length,0);
});

test('falta de permissão do bot ou hierarquia impede banimento',async()=>{
  for (const mode of ['permission','actorHierarchy','botHierarchy']) {
    const f=fixture('ban');
    if (mode==='permission') f.bot.permissions=permissions();
    if (mode==='actorHierarchy') f.target.roles.highest=role(5);
    if (mode==='botHierarchy') f.target.bannable=false;
    await assert.rejects(handleModeration(f.i,f.store));
    assert.equal(f.calls.some(c=>c[0]==='ban'),false);
  }
});

test('ban, kick, timeout, untimeout e nick executam a ação correta e registram autor',async()=>{
  for (const name of ['ban','kick','timeout','untimeout','nick']) {
    const f=fixture(name);
    await handleModeration(f.i,f.store);
    const action=f.calls.find(c=>c[0]===(name==='untimeout' ? 'timeout' : name));
    assert.ok(action,name);
    if (name==='timeout') assert.equal(action[1],600_000);
    if (name==='untimeout') assert.equal(action[1],null);
    if (name==='ban') assert.equal(action[1].deleteMessageSeconds,0);
    const audit=f.calls.find(c=>c[0]==='audit')[1];
    assert.equal(audit.actorId,ids.actor);
    assert.equal(audit.targetId,ids.target);
    assert.equal(f.calls.at(-1)[1].allowedMentions.parse.length,0);
  }
});

test('unban valida o ID antes de chamar o Discord',async()=>{
  const f=fixture('unban');
  f.values.id='inválido';
  await assert.rejects(handleModeration(f.i,f.store),/ID/);
  assert.equal(f.calls.length,0);
});

test('cleanup preserva fixadas e antigas e informa quantas apagou',async()=>{
  const f=fixture('cleanup');
  const messages=new Collection([
    ['1',{id:'1',pinned:true,createdTimestamp:Date.now()}],
    ['2',{id:'2',pinned:false,createdTimestamp:Date.now()-15*86_400_000}],
    ['3',{id:'3',pinned:false,createdTimestamp:Date.now()}],
    ['4',{id:'4',pinned:false,createdTimestamp:Date.now()}]
  ]);
  f.channel.messages={fetch:async()=>messages};
  f.channel.bulkDelete=async list=>{assert.deepEqual(list.map(m=>m.id),['3','4']);return new Collection(list.map(m=>[m.id,m]));};
  await handleModeration(f.i,f.store);
  assert.match(f.calls.at(-1)[1].content,/2 mensagem/);
});

test('unlock restaura estado neutro ou explícito salvo, nunca força permissão nova',async()=>{
  for (const oldValue of [null,true]) {
    const f=fixture('lock');
    if (oldValue===true) f.channel.permissionOverwrites.cache.set(ids.guild,{allow:permissions(P.SendMessages),deny:permissions()});
    await handleModeration(f.i,f.store);
    assert.deepEqual(f.calls.find(c=>c[0]==='overwrite')[1],{SendMessages:false});
    f.i.commandName='unlock';
    await handleModeration(f.i,f.store);
    assert.deepEqual(f.calls.filter(c=>c[0]==='overwrite').at(-1)[1],{SendMessages:oldValue});
  }
  const f=fixture('unlock');
  await assert.rejects(handleModeration(f.i,f.store),/Não há um bloqueio/);
  assert.equal(f.calls.length,0);
});

test('advertência persiste no store e consulta não notifica ninguém',async()=>{
  const f=fixture('warn');
  await handleModeration(f.i,f.store);
  assert.equal((await f.store.read('warnings-'+ids.guild+'-'+ids.target)).length,1);
  f.i.commandName='warnings';
  await handleModeration(f.i,f.store);
  const reply=f.calls.at(-1)[1];
  assert.ok(reply.embeds[0].toJSON().description.includes('Teste'));
  assert.deepEqual(reply.allowedMentions,{parse:[]});
  f.i.commandName='clearwarn';
  await handleModeration(f.i,f.store);
  assert.deepEqual(await f.store.read('warnings-'+ids.guild+'-'+ids.target),[]);
});

test('cargo adiciona e remove somente um cargo permitido e impede privilégios extras',async()=>{
  for (const operation of ['adicionar','remover']) {
    const f=fixture('cargo');
    f.values.operation=operation;
    f.values.cargo={id:ids.role};
    const selected=role(2,{id:ids.role,name:'Membro',managed:false,permissions:permissions()});
    f.i.guild.roles={fetch:async()=>selected};
    f.target.roles.add=async r=>f.calls.push(['addRole',r.id]);
    f.target.roles.remove=async r=>f.calls.push(['removeRole',r.id]);
    await handleModeration(f.i,f.store);
    assert.ok(f.calls.some(c=>c[0]===(operation==='adicionar' ? 'addRole' : 'removeRole') && c[1]===ids.role));
  }
  const f=fixture('cargo',{actorPermissions:permissions(P.ManageRoles)});
  f.values.cargo={id:ids.role};f.values.operation='adicionar';
  f.i.guild.roles={fetch:async()=>role(2,{id:ids.role,managed:false,permissions:permissions(P.Administrator)})};
  await assert.rejects(handleModeration(f.i,f.store),/permissões que não possui/);
  assert.equal(f.calls.length,0);
});

test('anunciar exige acesso do autor ao destino e não permite notificações',async()=>{
  const f=fixture('anunciar');
  f.values.canal={id:ids.channel};f.values.mensagem='Aviso @everyone';
  f.i.guild.name='Servidor';
  f.channel.send=async payload=>{f.calls.push(['send',payload]);return {id:'123',url:'https://discord.com/channels/exemplo'};};
  await handleModeration(f.i,f.store);
  const sent=f.calls.find(c=>c[0]==='send')[1];
  assert.deepEqual(sent.allowedMentions,{parse:[]});
  assert.equal(sent.embeds[0].toJSON().description,'Aviso @everyone');
  f.values.cor='inválida';
  await assert.rejects(handleModeration(f.i,f.store),/hexadecimal/);
  assert.equal(f.calls.filter(c=>c[0]==='send').length,1);
  delete f.values.cor;
  f.channel.permissionsFor=member=>member.id===ids.actor ? permissions() : member.permissions;
  await assert.rejects(handleModeration(f.i,f.store),/Você precisa poder ver/);
  assert.equal(f.calls.filter(c=>c[0]==='send').length,1);
});

test('slowmode valida limites e zero desativa',async()=>{
  const f=fixture('slowmode');f.values.segundos=0;
  await handleModeration(f.i,f.store);
  assert.deepEqual(f.calls.find(c=>c[0]==='slowmode'),['slowmode',0]);
  f.values.segundos=21601;
  await assert.rejects(handleModeration(f.i,f.store),/21600/);
});

test('userinfo e serverinfo respondem com dados sem mutações',async()=>{
  for (const name of ['userinfo','serverinfo']) {
    const f=fixture(name);
    Object.assign(f.values.membro,{createdTimestamp:0,displayAvatarURL:()=> 'https://cdn.discordapp.com/embed/avatars/0.png'});
    Object.assign(f.target,{displayName:'Cliente',joinedTimestamp:Date.now()});
    f.target.roles.highest.name='Membro';
    Object.assign(f.i.guild,{name:'Servidor',memberCount:10,createdTimestamp:Date.now(),iconURL:()=>null});
    if (name==='serverinfo') f.i.guild.channels.fetch=async()=>new Collection([[ids.channel,f.channel]]);
    await handleModeration(f.i,f.store);
    assert.equal(f.calls.length,1);
    assert.ok(f.calls[0][1].embeds[0].toJSON().fields.length>0);
    assert.deepEqual(f.calls[0][1].allowedMentions,{parse:[]});
  }
});
