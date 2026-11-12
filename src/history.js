import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { ApplicationFlags, ChannelType, PermissionFlagsBits as P, EmbedBuilder } from 'discord.js';

const data = new URL('../data/', import.meta.url);
let logsChannel;

function personLabel(guild, userId) {
  const member = guild.members.cache.get(userId);
  const user = member?.user ?? guild.client.users.cache.get(userId);
  const name = member?.displayName ?? user?.globalName ?? user?.username;
  return name ? '`'+name.replace(/`/g,"'")+'`\n`'+userId+'`' : '`'+userId+'`';
}

export async function prepareLogs(guild, supportRoleIds, botId) {
  const ids = Array.isArray(supportRoleIds) ? supportRoleIds : [supportRoleIds];
  await mkdir(data, {recursive:true});
  const stateFile = new URL('logs-channel.json', data);
  let state;
  try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state?.guildId === guild.id) {
    try { logsChannel = await guild.channels.fetch(state.channelId); }
    catch (error) { if (error.code !== 10003) throw error; logsChannel = null; }
  }
  const access = [P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.AttachFiles,P.EmbedLinks];
  const permissionOverwrites = [
    {id:guild.id,deny:[P.ViewChannel]},
    ...ids.map(id => ({id,allow:access})),
    {id:botId,allow:[...access,P.ManageChannels,P.ManageRoles]}
  ];
  if (!logsChannel) {
    logsChannel = await guild.channels.create({name:'logs-tickets',type:ChannelType.GuildText,permissionOverwrites,reason:'Registros privados do atendimento'});
    await writeFile(stateFile,JSON.stringify({guildId:guild.id,channelId:logsChannel.id}));
  } else {
    if (logsChannel.type !== ChannelType.GuildText) throw new Error('O canal de logs precisa ser um canal de texto.');
    await logsChannel.permissionOverwrites.set(permissionOverwrites,'Logs visíveis somente para a equipe');
  }
  return logsChannel;
}

export async function recordEvent(action, channel, ticket, actorId, details = '') {
  const event = {time:new Date().toISOString(),action,guildId:channel.guild.id,channelId:channel.id,owner:ticket.owner,actorId,assignee:ticket.assignee ?? null,category:ticket.category,payment:ticket.payment,details};
  try {
    await mkdir(data,{recursive:true});
    await appendFile(new URL('events.jsonl',data),JSON.stringify(event)+'\n');
  } catch (error) { console.error('Falha no log local: '+(error.code || error.name)); }
  try {
    if (!logsChannel) throw new Error('Canal de logs indisponível');
    const embed = new EmbedBuilder().setTitle(action).setColor(action.includes('encerrado') ? 0xed4245 : 0x5865f2)
      .addFields(
        {name:'Ticket',value:channel.name+'\n`'+channel.id+'`',inline:true},
        {name:'Titular',value:personLabel(channel.guild,ticket.owner),inline:true},
        {name:'Responsável',value:ticket.assignee ? personLabel(channel.guild,ticket.assignee) : 'Aguardando atendimento',inline:true},
        {name:'Ação por',value:personLabel(channel.guild,actorId),inline:true},
        {name:'Assunto',value:ticket.category || 'Não escolhido',inline:true},
        {name:'Pagamento',value:({none:'Sem solicitação',review:'Em conferência',approved:'Aprovado'})[ticket.payment],inline:true}
      ).setFooter({text:'Registro de atendimento'}).setTimestamp();
    if (details) embed.setDescription(details.slice(0,4000));
    await logsChannel.send({embeds:[embed],allowedMentions:{parse:[]}});
  } catch (error) { console.error('Falha ao enviar log ao Discord: '+(error.code || error.name)); }
}

export async function sendStaffMessage(payload) {
  if (!logsChannel) throw new Error('O canal privado da equipe está indisponível. Peça a um administrador para conferir o canal de logs.');
  return logsChannel.send({...payload,allowedMentions:{parse:[]}});
}

export function formatMessage(message) {
  const lines = [`[${new Date(message.createdTimestamp).toISOString()}] ${message.author?.tag ?? 'Desconhecido'} (${message.author?.id ?? '?'}) | mensagem ${message.id}`];
  if (message.editedTimestamp) lines.push('Editada em: '+new Date(message.editedTimestamp).toISOString());
  if (message.content) lines.push(message.content);
  for (const embed of message.embeds ?? []) {
    if (embed.title) lines.push(embed.title);
    if (embed.description) lines.push(embed.description);
    for (const field of embed.fields ?? []) lines.push(field.name+': '+field.value);
  }
  for (const attachment of message.attachments?.values() ?? []) lines.push('Anexo: '+attachment.name+' | '+attachment.url);
  for (const sticker of message.stickers?.values() ?? []) lines.push('Sticker: '+sticker.name);
  if (message.reference?.messageId) lines.push('Resposta à mensagem: '+message.reference.messageId);
  return lines.join('\n')+'\n\n';
}

export async function fetchHistory(channel) {
  const messages = [];
  let before;
  while (true) {
    const page = await channel.messages.fetch({limit:100,before,cache:false});
    if (!page.size) break;
    messages.push(...page.values());
    const next = [...page.keys()].reduce((a,b)=>BigInt(a)<BigInt(b)?a:b);
    if (before && BigInt(next)>=BigInt(before)) throw new Error('Falha ao percorrer as mensagens.');
    before = next;
  }
  return messages.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
}

export function splitTranscript(text, maxBytes = 7_000_000) {
  if (maxBytes < 4) throw new Error('O limite deve comportar um caractere UTF-8.');
  const chunks = [];
  let parts = [], size = 0;
  for (const char of text) {
    const bytes = Buffer.byteLength(char);
    if (size+bytes > maxBytes) { chunks.push(Buffer.from(parts.join(''))); parts=[]; size=0; }
    parts.push(char); size+=bytes;
  }
  if (size) chunks.push(Buffer.from(parts.join('')));
  return chunks;
}

export async function hasMessageContent(client) {
  const application = await client.application.fetch();
  return application.flags.has(ApplicationFlags.GatewayMessageContent) || application.flags.has(ApplicationFlags.GatewayMessageContentLimited);
}

export async function saveTranscript(channel, ticket, actorId) {
  if (!await hasMessageContent(channel.client)) throw new Error('Message Content Intent não está habilitado. Ative em Discord Developer Portal → Bot.');
  const messages = await fetchHistory(channel);
  const text = [
    'HISTÓRICO DE ATENDIMENTO',
    'Servidor: '+channel.guild.id,
    'Ticket: '+channel.name+' ('+channel.id+')',
    'Titular: '+ticket.owner,
    'Responsável: '+(ticket.assignee || 'Não assumido'),
    'Assunto: '+(ticket.category || 'Não escolhido'),
    'Pagamento: '+ticket.payment,
    'Aberto em: '+new Date(channel.createdTimestamp).toISOString(),
    'Encerramento solicitado por: '+actorId,
    'Exportado em: '+new Date().toISOString(),
    'Mensagens: '+messages.length,
    '',
    'Mensagens apagadas não são recuperadas. Anexos são links que podem expirar.',
    '',
    ...messages.map(formatMessage)
  ].join('\n');
  await mkdir(new URL('transcripts/',data),{recursive:true});
  await writeFile(new URL(channel.id+'.txt',new URL('transcripts/',data)),text,'utf8');
  let delivered = false;
  try {
    if (!logsChannel) throw new Error('Canal de logs indisponível');
    const chunks = splitTranscript(text);
    for (let index=0;index<chunks.length;index++) {
      await logsChannel.send({content:`📄 Conversa do ticket **${channel.name}** (${channel.id}) • Parte ${index+1}/${chunks.length}`,files:[{attachment:chunks[index],name:`ticket-${channel.id}-${index+1}.txt`}],allowedMentions:{parse:[]}});
    }
    delivered = true;
  } catch (error) { console.error('TXT salvo localmente; falha no envio ao Discord: '+(error.code || error.name)); }
  return {messageCount:messages.length,delivered};
}
