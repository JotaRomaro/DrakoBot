import { Client, Events, GatewayIntentBits, ChannelType, PermissionFlagsBits as P, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { config, env } from './settings.js';
import { topicOf, parseTopic, isStaff, withLock, claimTicket, assertCanCloseTicket } from './domain.js';
import { prepareLogs, recordEvent, hasMessageContent, sendStaffMessage, fetchHistory } from './history.js';
import { closeTicket } from './closing.js';
import { moderationCommands, handleModeration } from './moderation.js';
import { createPixPayment } from './pix.js';

const client = new Client({ intents:[GatewayIntentBits.Guilds], allowedMentions:{parse:[]} });
const locks = new Set();
const row = (...items) => new ActionRowBuilder().addComponents(...items);
const button = (id,label,style=ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const card = (title,description,color=0x5865f2) => new EmbedBuilder().setTitle(title.slice(0,256)).setDescription(description).setColor(color).setFooter({text:config.panelTitle});
const categoryMenu = (id='ticket:category') => row(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder('Escolha: suporte ou compras').addOptions(config.categories.map(c=>({label:c.label,value:c.id,description:c.description,emoji:c.id==='vip' ? '🛒' : '💬'}))));
const closeRow = (ticket) => row(...(ticket.assignee ? [] : [button('ticket:claim','Assumir atendimento',ButtonStyle.Primary).setEmoji('🙋')]),button('ticket:close','Encerrar ticket',ButtonStyle.Danger).setEmoji('🔒'));
const canPay = () => Boolean(config.vip.pixKey.trim() && config.vip.price.trim() && config.vip.receiverName.trim());

async function setup(guild) {
  const [roles, category, me] = await Promise.all([guild.roles.fetch(),guild.channels.fetch(env.TICKET_CATEGORY_ID),guild.members.fetchMe()]);
  const support = env.SUPPORT_ROLE_IDS.map(id => roles.get(id));
  const vip = roles.get(env.VIP_ROLE_ID);
  if (support.some(role => !role) || !vip || category?.type !== ChannelType.GuildCategory) throw new Error('Confira os IDs dos cargos e da categoria de tickets no .env.');
  if (support.some(role => role.managed || role.id === me.roles.highest.id) || vip.managed) throw new Error('Use cargos próprios para equipe e VIP, distintos do cargo do bot.');
  if (vip.permissions.has(P.Administrator) || vip.permissions.has(P.ManageRoles) || vip.permissions.has(P.ManageChannels)) throw new Error('O cargo VIP não pode conceder administração ou gerenciar cargos/canais.');
  if (vip.position >= me.roles.highest.position) throw new Error('Mova o cargo do bot para cima do cargo VIP.');
  if (!me.permissions.has(P.ManageRoles)) throw new Error('Dê ao bot a permissão Gerenciar cargos.');
  if (!category.permissionsFor(me)?.has([P.ViewChannel,P.ManageChannels,P.ManageRoles])) throw new Error('O bot precisa Ver canal, Gerenciar canais e Gerenciar permissões na categoria de tickets.');
  return {vip};
}

async function openTicket(i, categoryId=null) {
  await i.deferReply({flags:MessageFlags.Ephemeral});
  await withLock(locks,'open:'+i.guildId+':'+i.user.id,async()=>{
    const selected = categoryId === null ? null : config.categories.find(c=>c.id===categoryId);
    if (categoryId !== null && !selected) throw new Error('Essa opção não existe mais. Peça à equipe para atualizar o painel.');
    await setup(i.guild);
    const channels = await i.guild.channels.fetch();
    const existing = channels.find(c=>{const t=parseTopic(c?.topic); return t?.owner===i.user.id && t.status==='open';});
    if (existing) return i.editReply('Você já tem um ticket aberto: <#'+existing.id+'>');
    const ticket = {owner:i.user.id,status:'open',category:selected?.id ?? null,payment:'none'};
    const access = [P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.AttachFiles,P.EmbedLinks];
    const channel = await i.guild.channels.create({
      name:(selected ? selected.id==='vip' ? 'compras-' : 'suporte-' : 'ticket-')+i.user.id.slice(-6),type:ChannelType.GuildText,parent:env.TICKET_CATEGORY_ID,topic:topicOf(ticket),
      permissionOverwrites:[{id:i.guild.id,deny:[P.ViewChannel]},{id:i.user.id,allow:access},...env.SUPPORT_ROLE_IDS.map(id => ({id,allow:access})),{id:client.user.id,allow:[...access,P.ManageChannels,P.ManageRoles]}],
      reason:'Ticket solicitado pelo usuário '+i.user.id
    });
    try {
      if (selected) {
        await channel.send({content:'Olá, <@'+i.user.id+'>! Seu atendimento é privado. A equipe já pode te ajudar por aqui.',...await ticketContent(selected,ticket,channel.id)});
      } else {
        // Compatibilidade com o botão Abrir ticket dos painéis antigos.
        await channel.send({content:'Olá, <@'+i.user.id+'>!',embeds:[card('🎫 Seu atendimento começou','Escolha o assunto no menu abaixo e conte como podemos ajudar.\n\n🔐 Este espaço é privado: somente você, a equipe e administradores têm acesso.')],components:[categoryMenu(),closeRow(ticket)]});
      }
    } catch(error) {
      await channel.delete('Falha ao iniciar ticket').catch(()=>{});
      throw error;
    }
    await i.editReply('Seu ticket foi aberto: <#'+channel.id+'>');
  });
}

export function categoryContent(selected,ticket) {
  const embeds = [card((selected.id==='vip' ? '⭐ ' : '💬 ')+selected.label,selected.message).addFields({name:'Responsável',value:ticket.assignee ? '<@'+ticket.assignee+'>' : 'Aguardando um atendente'})];
  const components = [];
  if (selected.id === 'vip') {
    const v = config.vip;
    embeds.push(card('⭐ '+(v.name || 'VIP'),v.instructions || 'Converse com a equipe para concluir a compra.',0xfee75c).addFields(
      {name:'Benefícios e duração',value:v.benefits || 'Consulte a equipe.'},
      {name:'Valor',value:v.price || 'Consulte a equipe.',inline:true},
      {name:'Destinatário',value:v.receiverName || 'Consulte a equipe.',inline:true},
      {name:'Pagamento Pix',value:canPay() ? v.pixKey : 'Solicite os dados à equipe.'}
    ));
    components.push(row(button('ticket:paid','Já paguei',ButtonStyle.Success).setEmoji('💳').setDisabled(ticket.payment!=='none')));
  }
  components.push(closeRow(ticket));
  return {embeds,components};
}

export async function ticketContent(selected,ticket,reference) {
  const content=categoryContent(selected,ticket);
  if (selected.id==='vip' && canPay() && config.vip.receiverCity?.trim()) {
    try {
      const pix=await createPixPayment(config.vip,reference);
      content.embeds[1].setImage('attachment://pix.png').addFields({name:'📱 QR Code e Pix Copia e Cola',value:'Escaneie a imagem ou copie o código abaixo no app do seu banco.\n```'+pix.payload+'```'});
      content.files=[pix.file];
    } catch (error) {
      console.error('QR Code Pix indisponível: '+(error.code || error.message || error.name));
      content.embeds[1].addFields({name:'QR Code',value:'Não foi possível gerar a imagem. Use a chave Pix acima e confira os dados com a equipe.'});
    }
  }
  return content;
}

async function selectCategory(i,ticket) {
  if (i.user.id !== ticket.owner) throw new Error('Somente quem abriu o ticket pode escolher o assunto.');
  if (ticket.category) throw new Error('O assunto deste ticket já foi escolhido. Abra outro depois de encerrá-lo.');
  const selected = config.categories.find(c=>c.id===i.values[0]);
  if (!selected) throw new Error('Essa opção não existe mais. Peça à equipe para atualizar o painel.');
  ticket.category = selected.id;
  await i.channel.setTopic(topicOf(ticket));
  try {
    await i.channel.send(await ticketContent(selected,ticket,i.channelId));
    await i.message.edit({components:[]});
  } catch(error) {
    // Se a publicação falhar, permita escolher novamente.
    ticket.category=null;
    await i.channel.setTopic(topicOf(ticket)).catch(()=>{});
    throw error;
  }
  await i.editReply('Assunto escolhido: '+selected.label+'. Continue o atendimento no ticket.');
}

export function paymentReview(ticket,channelId) {
  return {embeds:[card('💳 Pagamento aguardando conferência','O cliente informou que pagou. Confira o crédito na conta antes de liberar o VIP.\n\nO comprovante sozinho não confirma o recebimento.',0xfee75c).addFields(
    {name:'Cliente',value:'`'+ticket.owner+'`',inline:true},
    {name:'Ticket e comprovante',value:'<#'+channelId+'>',inline:true},
    {name:'Valor esperado',value:canPay() ? config.vip.price : 'Confira o valor e os dados combinados com o cliente neste atendimento.'}
  )],allowedMentions:{parse:[]},components:[row(button('ticket:approve:'+channelId,'Confirmar e liberar VIP',ButtonStyle.Success),button('ticket:reject:'+channelId,'Pagamento não localizado',ButtonStyle.Danger))]};
}

export async function markPaid(i,ticket,log=recordEvent,sendReview=sendStaffMessage) {
  if (i.user.id !== ticket.owner || ticket.category !== 'vip') throw new Error('Esse botão é exclusivo do titular do ticket VIP.');
  if (ticket.payment !== 'none') throw new Error(ticket.payment==='approved' ? 'Seu VIP já foi aprovado.' : 'Seu pagamento já está aguardando conferência.');
  ticket.payment='review';
  await i.channel.setTopic(topicOf(ticket));
  try {
    await sendReview(paymentReview(ticket,i.channelId));
  } catch(error) { ticket.payment='none'; await i.channel.setTopic(topicOf(ticket)).catch(()=>{}); throw error; }
  await i.message.edit({components:i.message.components.map(componentRow=>ActionRowBuilder.from(componentRow).setComponents(
    componentRow.components.map(component=>component.customId==='ticket:paid' ? ButtonBuilder.from(component).setDisabled(true) : component)
  ))}).catch(()=>{});
  await i.editReply('Envie o comprovante e aguarde!');
  await log('💳 Pagamento em conferência',i.channel,ticket,i.user.id);
}

async function approve(i,ticket,staff,channel,log=recordEvent) {
  if (!staff) throw new Error('Somente a equipe pode confirmar o recebimento.');
  if (ticket.category!=='vip' || ticket.payment!=='review') throw new Error('Não há um pagamento aguardando conferência.');
  const {vip} = await setup(i.guild);
  const member = await i.guild.members.fetch(ticket.owner);
  await member.roles.add(vip,'Pix conferido por '+i.user.id+' no ticket '+channel.id);
  ticket.payment='approved';
  // A atribuição do cargo é idempotente: se salvar falhar, pode-se repetir a aprovação.
  await channel.setTopic(topicOf(ticket));
  await i.message.edit({components:[]}).catch(()=>{});
  await channel.send({embeds:[card('✅ VIP liberado','<@'+ticket.owner+'>, seu pagamento foi confirmado e o cargo VIP já foi entregue.\n\nConferido por <@'+i.user.id+'>. Obrigado pela compra!',0x57f287)]});
  await i.editReply('Recebimento confirmado e cargo VIP entregue.');
  await log('✅ Pagamento aprovado • VIP entregue',channel,ticket,i.user.id);
}

export async function handleTicket(i,log=recordEvent) {
  await i.deferReply({flags:MessageFlags.Ephemeral});
  const review = /^ticket:(approve|reject):(\d{17,20})$/.exec(i.customId);
  const channelId = review ? review[2] : i.channelId;
  await withLock(locks,'channel:'+channelId,async()=>{
    const channel = await i.guild.channels.fetch(channelId,{force:true});
    const ticket = parseTopic(channel?.topic);
    if (!ticket || channel.parentId !== env.TICKET_CATEGORY_ID || ticket.status!=='open') throw new Error('Este ticket não está ativo.');
    const member = await i.guild.members.fetch({user:i.user.id,force:true});
    const staff = isStaff(member,env.SUPPORT_ROLE_IDS);
    if (!staff && i.user.id !== ticket.owner) throw new Error('Você não pode gerenciar este ticket.');
    const id=review ? 'ticket:'+review[1] : i.customId;
    if (id==='ticket:close' || id==='ticket:close-confirm') assertCanCloseTicket(member);
    if (id==='ticket:claim') {
      const claimed = claimTicket(ticket,i.user.id,staff);
      await channel.setTopic(topicOf(claimed));
      await i.message.edit({components:i.message.components.map(componentRow=>
        ActionRowBuilder.from(componentRow).setComponents(componentRow.components.filter(component=>component.customId!=='ticket:claim'))
      ).filter(componentRow=>componentRow.components.length)});
      await channel.send({embeds:[card('🙋 Atendimento assumido','<@'+i.user.id+'> está cuidando do seu ticket.\nConte os detalhes da sua solicitação por aqui.',0x57f287)],allowedMentions:{parse:[]}});
      await i.editReply('Você assumiu este atendimento.');
      return;
    }
    if (i.isStringSelectMenu() && id==='ticket:category') return selectCategory(i,ticket);
    if (id==='ticket:paid') return markPaid(i,ticket,log);
    if (id==='ticket:approve') return approve(i,ticket,staff,channel,log);
    if (id==='ticket:reject') {
      if (!staff || ticket.category!=='vip' || ticket.payment!=='review') throw new Error('Somente a equipe pode revisar um pagamento pendente.');
      ticket.payment='none';
      await channel.setTopic(topicOf(ticket));
      await i.message.edit({components:[]}).catch(()=>{});
      await channel.send({embeds:[card('⚠️ Pagamento não localizado','Confira os dados com a equipe. Se já pagou, envie o comprovante e solicite uma nova conferência pelo botão **Já paguei**.',0xfee75c)],components:[row(button('ticket:paid','Já paguei',ButtonStyle.Success).setEmoji('💳'))]});
      await log('⚠️ Pagamento não localizado',channel,ticket,i.user.id);
      return i.editReply('Revisão reaberta. O usuário pode solicitar uma nova conferência.');
    }
    if (id==='ticket:close') {
      return i.editReply({embeds:[card('🔒 Finalizar atendimento?','Vamos salvar a conversa em TXT para a equipe e encerrar o ticket.\nSe não for possível salvar, o canal será arquivado para preservar as mensagens.',0xed4245)],components:[row(button('ticket:close-confirm','Confirmar encerramento',ButtonStyle.Danger))]});
    }
    if (id==='ticket:close-confirm') {
      await i.editReply({content:'Salvando a conversa e finalizando o atendimento...',embeds:[],components:[]});
      const result = await closeTicket(channel,ticket,i.user.id);
      return i.editReply({content:result.archived ? 'Atendimento finalizado. A conversa foi preservada em um canal privado da equipe.' : 'Ticket encerrado. A conversa foi salva para a equipe.',components:[]});
    }
    throw new Error('Ação desconhecida.');
  });
}

export async function migratePaymentReviews(guild,botId,sendReview=sendStaffMessage,history=fetchHistory) {
  const channels=await guild.channels.fetch();
  for (const channel of channels.values()) {
    const ticket=parseTopic(channel?.topic);
    if (channel?.parentId!==env.TICKET_CATEGORY_ID || ticket?.status!=='open' || ticket.category!=='vip' || ticket.payment!=='review') continue;
    await withLock(locks,'channel:'+channel.id,async()=>{
      const messages=await history(channel);
      const oldReviews=messages.filter(message=>message.author?.id===botId && message.components?.some(componentRow=>componentRow.components.some(component=>['ticket:approve','ticket:reject'].includes(component.customId))));
      if (!oldReviews.length) return;
      await sendReview(paymentReview(ticket,channel.id));
      for (const message of oldReviews) {
        try { await message.delete(); }
        catch { await message.edit({content:'Solicitação encaminhada para a equipe. Envie o comprovante e aguarde!',embeds:[],components:[],allowedMentions:{parse:[]}}); }
      }
      console.log('Conferência de pagamento movida para o canal privado: '+channel.id);
    }).catch(error=>console.error('Falha ao mover conferência antiga: '+(error.code || error.name)));
  }
}

client.once(Events.ClientReady, async ready=>{
  try {
    const guild = await ready.guilds.fetch(env.GUILD_ID);
    await setup(guild);
    try {
      const logs = await prepareLogs(guild,env.SUPPORT_ROLE_IDS,ready.user.id);
      console.log('Logs de atendimento: '+logs.name+' ('+logs.id+').');
      await migratePaymentReviews(guild,ready.user.id);
    } catch (error) { console.error('Logs indisponíveis no Discord: '+(error.code || error.name)); }
    try {
      if (!await hasMessageContent(ready)) console.log('Para exportar conversas em TXT, ative Message Content Intent em Discord Developer Portal → Bot. Até lá, tickets encerrados serão arquivados.');
    } catch (error) { console.error('Falha ao verificar acesso às conversas: '+(error.code || error.name)); }
    console.log('Bot online: '+ready.user.tag+'. Use /painel no canal de atendimento.');
    if (!canPay()) console.log('Pix não configurado. Preencha vip.price, vip.pixKey e vip.receiverName no config.json.');
    else if (!config.vip.receiverCity?.trim()) console.log('QR Code Pix pendente: preencha vip.receiverCity com a cidade do recebedor.');
  } catch(error) {console.error('Configuração: '+error.message); client.destroy(); process.exitCode=1;}
});
client.on(Events.InteractionCreate,async i=>{
  if (!i.inGuild() || i.guildId!==env.GUILD_ID) return;
  try {
    if (i.isChatInputCommand() && moderationCommands.has(i.commandName)) return await handleModeration(i);
    if (i.isChatInputCommand() && i.commandName==='painel') {
      if (!i.memberPermissions.has(P.Administrator)) throw new Error('Somente administradores podem publicar o painel.');
      await i.deferReply({flags:MessageFlags.Ephemeral});
      if (i.channel.type!==ChannelType.GuildText) throw new Error('Publique o painel em um canal de texto do servidor.');
      await setup(i.guild);
      const panel = card('🎫 '+config.panelTitle,config.panelDescription).addFields(
        ...config.categories.map(c=>({name:(c.id==='vip' ? '🛒 ' : '💬 ')+c.label,value:c.description,inline:true}))
      );
      const icon = i.guild.iconURL();
      if (icon) panel.setThumbnail(icon);
      await i.channel.send({embeds:[panel],components:[categoryMenu('ticket:open-category')]});
      return await i.editReply('Painel publicado.');
    }
    if (i.isButton() && i.customId==='ticket:open') return await openTicket(i);
    if (i.isStringSelectMenu() && i.customId==='ticket:open-category') return await openTicket(i,i.values[0]);
    if ((i.isButton() || i.isStringSelectMenu()) && i.customId.startsWith('ticket:')) await handleTicket(i);
  } catch(error) {
    // Não imprima payloads ou tokens no console.
    console.error('Falha na ação: '+(error.code || error.name));
    const message = error instanceof Error && !('requestBody' in error) ? error.message : 'Não foi possível concluir. Peça à equipe para conferir as permissões do bot e tentar novamente.';
    const payload={content:message.slice(0,1900),components:[],allowedMentions:{parse:[]}};
    if (i.deferred || i.replied) await i.editReply(payload).catch(()=>{});
    else await i.reply({...payload,flags:MessageFlags.Ephemeral}).catch(()=>{});
  }
});
client.login(env.DISCORD_TOKEN).catch(()=>{console.error('Não foi possível conectar ao Discord. Confira token e conexão.');process.exitCode=1;});
