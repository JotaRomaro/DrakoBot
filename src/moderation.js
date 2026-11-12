import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits as P } from 'discord.js';
import { commandPermissions } from './commands.js';
import { moderationStore } from './moderation-store.js';
import { withLock } from './domain.js';
import { buildAnnouncement } from './announcement.js';

const locks = new Set();
const channelPermissions = new Set(['cleanup','lock','unlock','slowmode']);
export const moderationCommands = new Set(Object.keys(commandPermissions).filter(name=>name!=='painel'));

export function parseDuration(value) {
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(value.trim());
  if (!match) throw new Error('Use um tempo como 30s, 10m, 2h ou 7d.');
  const duration = Number(match[1])*({s:1000,m:60_000,h:3_600_000,d:86_400_000})[match[2].toLowerCase()];
  if (!Number.isSafeInteger(duration) || duration<1000 || duration>28*86_400_000) throw new Error('O tempo deve ser entre 1 segundo e 28 dias.');
  return duration;
}

export function assertTarget(actor, target, guild, botId) {
  if (target.id===actor.id) throw new Error('Você não pode usar esta ação em si mesmo.');
  if (target.id===guild.ownerId) throw new Error('Esta ação não pode ser aplicada ao dono do servidor.');
  if (target.id===botId) throw new Error('Esta ação não pode ser aplicada ao próprio bot.');
  if (actor.id!==guild.ownerId && actor.roles.highest.comparePositionTo(target.roles.highest)<=0) throw new Error('O membro precisa ter um cargo abaixo do seu.');
}

export function assertRole(actor, bot, role, guild) {
  if (role.id===guild.id || role.managed) throw new Error('Não é possível gerenciar @everyone ou cargos de integrações.');
  if (bot.roles.highest.comparePositionTo(role)<=0) throw new Error('O cargo precisa estar abaixo do cargo do bot.');
  if (actor.id!==guild.ownerId) {
    if (actor.roles.highest.comparePositionTo(role)<=0) throw new Error('O cargo precisa estar abaixo do seu cargo.');
    if (!actor.permissions.has(role.permissions.bitfield)) throw new Error('Você não pode gerenciar um cargo com permissões que não possui.');
  }
}

function requirePermission(permissions, permission, message) {
  if (!permissions?.has(permission)) throw new Error(message);
}

function textChannel(channel) {
  if (![ChannelType.GuildText,ChannelType.GuildAnnouncement].includes(channel?.type)) throw new Error('Use este comando em um canal de texto do servidor.');
}

const label = user=>'`'+(user.tag || user.username || user.id).replace(/`/g,"'")+'` (`'+user.id+'`)';
const date = timestamp=>timestamp ? '<t:'+Math.floor(timestamp/1000)+':f>' : 'Não disponível';

export async function handleModeration(i, store = moderationStore) {
  await i.deferReply({flags:MessageFlags.Ephemeral});
  const name = i.commandName;
  const permission = commandPermissions[name];
  if (!moderationCommands.has(name)) throw new Error('Comando de moderação desconhecido.');
  // Revalide permissões na execução, mesmo se alguém alterar a visibilidade do comando.
  const [actor, bot] = await Promise.all([
    i.guild.members.fetch({user:i.user.id,force:true}),i.guild.members.fetchMe({force:true})
  ]);
  const channel = channelPermissions.has(name) ? await i.guild.channels.fetch(i.channelId,{force:true}) : i.channel;
  const actorPermissions = channelPermissions.has(name) ? channel?.permissionsFor(actor) : actor.permissions;
  requirePermission(actorPermissions,permission,'Você não tem a permissão necessária para /'+name+'.');
  const reason = i.options.getString('motivo') || 'Não informado';
  const auditReason = ('/'+name+' por '+i.user.id+' | '+reason).slice(0,512);
  const done = async(content,details={})=>{
    await store.audit({action:name,guildId:i.guildId,channelId:i.channelId,actorId:i.user.id,reason,...details});
    return i.editReply({content,allowedMentions:{parse:[]}});
  };

  if (name==='unban') {
    const id = i.options.getString('id',true);
    if (!/^\d{17,20}$/.test(id)) throw new Error('Informe um ID de usuário válido.');
    requirePermission(bot.permissions,P.BanMembers,'O bot precisa da permissão Banir membros.');
    await i.guild.bans.remove(id,auditReason);
    return done('Banimento removido do usuário `'+id+'`.',{targetId:id});
  }

  if (name==='cleanup') {
    textChannel(channel);
    requirePermission(channel.permissionsFor(bot),[P.ViewChannel,P.ReadMessageHistory,P.ManageMessages],'O bot precisa Ver canal, Ler histórico e Gerenciar mensagens.');
    const amount = i.options.getInteger('quantidade',true);
    if (!Number.isInteger(amount) || amount<1 || amount>100) throw new Error('Escolha entre 1 e 100 mensagens.');
    return withLock(locks,'cleanup:'+channel.id,async()=>{
      const recent = await channel.messages.fetch({limit:100,cache:false});
      const cutoff = Date.now()-14*86_400_000+5000;
      const candidates = recent.filter(m=>!m.pinned && m.createdTimestamp>cutoff).first(amount);
      if (!candidates.length) return i.editReply('Nenhuma mensagem recente elegível. Mensagens fixadas ou com 14 dias ou mais são preservadas.');
      const deleted = await channel.bulkDelete(candidates,true);
      return done(deleted.size+' mensagem(ns) apagada(s). Mensagens fixadas e antigas foram preservadas.',{count:deleted.size});
    });
  }

  if (name==='lock' || name==='unlock') {
    textChannel(channel);
    requirePermission(channel.permissionsFor(bot),[P.ViewChannel,P.ManageRoles],'O bot precisa Ver canal e Gerenciar permissões neste canal.');
    return withLock(locks,'lock:'+channel.id,async()=>{
      const key='lock-'+i.guildId+'-'+channel.id;
      if (name==='lock') {
        const current = channel.permissionOverwrites.cache.get(i.guild.id);
        const oldValue = current?.deny.has(P.SendMessages) ? false : current?.allow.has(P.SendMessages) ? true : null;
        if (oldValue===false) throw new Error('O envio padrão de mensagens já está bloqueado neste canal.');
        const previous = await store.read(key);
        if (previous?.active) throw new Error('Este canal já tem um bloqueio salvo. Use /unlock antes de bloquear novamente.');
        // Salve antes de alterar para que /unlock funcione mesmo após reiniciar.
        await store.update(key,()=>({active:true,sendMessages:oldValue}));
        await channel.permissionOverwrites.edit(i.guild.id,{SendMessages:false},{reason:auditReason});
        return done('🔒 Envio de mensagens bloqueado para @everyone. Cargos com permissões próprias podem continuar enviando.');
      }
      const previous = await store.read(key);
      if (!previous?.active) throw new Error('Não há um bloqueio salvo pelo bot neste canal.');
      await channel.permissionOverwrites.edit(i.guild.id,{SendMessages:previous.sendMessages},{reason:auditReason});
      await store.update(key,()=>({...previous,active:false}));
      return done('🔓 Permissão padrão de envio restaurada ao estado anterior ao /lock.');
    });
  }

  if (name==='slowmode') {
    textChannel(channel);
    requirePermission(channel.permissionsFor(bot),[P.ViewChannel,P.ManageChannels],'O bot precisa Ver canal e Gerenciar canais.');
    const seconds = i.options.getInteger('segundos',true);
    if (!Number.isInteger(seconds) || seconds<0 || seconds>21600) throw new Error('Escolha um intervalo de 0 a 21600 segundos.');
    await channel.setRateLimitPerUser(seconds,auditReason);
    return done(seconds ? 'Modo lento definido para '+seconds+' segundos.' : 'Modo lento desativado.',{seconds});
  }

  if (name==='anunciar') {
    const destination = await i.guild.channels.fetch(i.options.getChannel('canal',true).id,{force:true});
    textChannel(destination);
    requirePermission(destination.permissionsFor(actor),[P.ViewChannel,P.SendMessages],'Você precisa poder ver e enviar mensagens no canal escolhido.');
    requirePermission(destination.permissionsFor(bot),[P.ViewChannel,P.SendMessages,P.EmbedLinks],'O bot precisa Ver canal, Enviar mensagens e Inserir links no canal escolhido.');
    const embed = buildAnnouncement(i.options);
    const sent = await destination.send({embeds:[embed],allowedMentions:{parse:[]}});
    return done('Anúncio publicado: '+sent.url,{destinationId:destination.id,messageId:sent.id});
  }

  if (name==='serverinfo') {
    const channels = await i.guild.channels.fetch();
    const embed = new EmbedBuilder().setTitle('ℹ️ '+i.guild.name).setColor(0x5865f2).addFields(
      {name:'ID',value:i.guildId,inline:true},{name:'Dono',value:'`'+i.guild.ownerId+'`',inline:true},
      {name:'Membros',value:String(i.guild.memberCount),inline:true},{name:'Canais',value:String(channels.size),inline:true},
      {name:'Criado em',value:date(i.guild.createdTimestamp)},{name:'Impulsos',value:String(i.guild.premiumSubscriptionCount ?? 0),inline:true}
    );
    const icon=i.guild.iconURL(); if (icon) embed.setThumbnail(icon);
    return i.editReply({embeds:[embed],allowedMentions:{parse:[]}});
  }

  const user = i.options.getUser('membro',true);
  // Consultas de advertências também funcionam se o usuário tiver saído do servidor.
  const warningKey='warnings-'+i.guildId+'-'+user.id;
  if (name==='warnings') {
    const warnings = await store.read(warningKey) || [];
    const lines = warnings.slice(-8).map(w=>date(Date.parse(w.time))+' • '+w.reason.slice(0,300)+'\nStaff: `'+w.actorId+'`');
    const embed = new EmbedBuilder().setTitle('📋 Advertências').setColor(0xfee75c).setDescription(label(user)+'\n\n'+(lines.join('\n\n') || 'Nenhuma advertência registrada.')).setFooter({text:'Total: '+warnings.length+' • Exibindo as 8 mais recentes'});
    return i.editReply({embeds:[embed],allowedMentions:{parse:[]}});
  }
  if (name==='clearwarn') {
    // Não permita apagar registros de superiores só porque o usuário está fora do cache.
    const target = await fetchMember(i.guild,user.id,true);
    if (target) assertTarget(actor,target,i.guild,i.client.user.id);
    else if (user.id===actor.id || user.id===i.guild.ownerId || user.id===i.client.user.id) throw new Error('Você não pode limpar os registros deste usuário.');
    let count=0;
    await store.update(warningKey,old=>{count=old?.length || 0;return [];});
    return done(count+' advertência(s) removida(s) de '+label(user)+'.',{targetId:user.id,count});
  }
  const target = await fetchMember(i.guild,user.id);
  if (name==='userinfo') {
    const embed = new EmbedBuilder().setTitle('👤 Informações do membro').setColor(0x5865f2).setDescription(label(user)).setThumbnail(user.displayAvatarURL()).addFields(
      {name:'Apelido',value:target.displayName,inline:true},{name:'Bot',value:user.bot ? 'Sim' : 'Não',inline:true},
      {name:'Conta criada em',value:date(user.createdTimestamp)},{name:'Entrou no servidor',value:date(target.joinedTimestamp)},
      {name:'Cargo mais alto',value:target.roles.highest.name,inline:true},{name:'Advertências',value:String((await store.read(warningKey))?.length || 0),inline:true}
    );
    return i.editReply({embeds:[embed],allowedMentions:{parse:[]}});
  }
  assertTarget(actor,target,i.guild,i.client.user.id);
  if (name==='warn') {
    const warnings = await store.update(warningKey,old=>[...(old || []),{time:new Date().toISOString(),actorId:actor.id,reason}]);
    return done('Advertência registrada para '+label(user)+'. Total: '+warnings.length+'.',{targetId:user.id});
  }
  requirePermission(bot.permissions,permission,'O bot não tem a permissão necessária para /'+name+'.');
  if (name==='cargo') {
    const role=await i.guild.roles.fetch(i.options.getRole('cargo',true).id);
    if (!role) throw new Error('O cargo não existe mais.');
    assertRole(actor,bot,role,i.guild);
    if (!target.manageable) throw new Error('O cargo do bot precisa estar acima dos cargos desse membro.');
    const operation = i.options.getSubcommand();
    if (operation==='adicionar') await target.roles.add(role,auditReason);
    else if (operation==='remover') await target.roles.remove(role,auditReason);
    else throw new Error('Operação de cargo inválida.');
    return done('Cargo `'+role.name.replace(/`/g,"'")+'` '+(operation==='adicionar' ? 'adicionado a ' : 'removido de ')+label(user)+'.',{targetId:user.id,roleId:role.id,operation});
  }
  if (name==='ban') {
    if (!target.bannable) throw new Error('O bot não pode banir esse membro. Confira a hierarquia dos cargos.');
    await target.ban({reason:auditReason,deleteMessageSeconds:0});
  } else if (name==='kick') {
    if (!target.kickable) throw new Error('O bot não pode expulsar esse membro. Confira a hierarquia dos cargos.');
    await target.kick(auditReason);
  } else if (name==='timeout' || name==='untimeout') {
    if (!target.moderatable) throw new Error('O bot não pode aplicar ou remover castigo desse membro. Confira cargos e permissões.');
    await target.timeout(name==='timeout' ? parseDuration(i.options.getString('tempo',true)) : null,auditReason);
  } else if (name==='nick') {
    if (!target.manageable) throw new Error('O cargo do bot precisa estar acima dos cargos desse membro.');
    await target.setNickname(i.options.getString('apelido') || null,auditReason);
  }
  const messages={ban:'Membro banido',kick:'Membro expulso',timeout:'Castigo aplicado',untimeout:'Castigo removido',nick:'Apelido atualizado'};
  return done(messages[name]+': '+label(user)+'.',{targetId:user.id});
}

async function fetchMember(guild, userId, optional = false) {
  try { return await guild.members.fetch({user:userId,force:true}); }
  catch (error) {
    if (error.code===10007) {
      if (optional) return null;
      throw new Error('Esse usuário não está no servidor.');
    }
    throw error;
  }
}
