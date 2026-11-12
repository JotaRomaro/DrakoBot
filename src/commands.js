import { SlashCommandBuilder, PermissionFlagsBits as P, ChannelType } from 'discord.js';

export const commandPermissions = {
  painel:P.Administrator, ban:P.BanMembers, unban:P.BanMembers, kick:P.KickMembers,
  timeout:P.ModerateMembers, untimeout:P.ModerateMembers, warn:P.ModerateMembers,
  warnings:P.ModerateMembers, clearwarn:P.ModerateMembers, cleanup:P.ManageMessages,
  lock:P.ManageChannels | P.ManageRoles, unlock:P.ManageChannels | P.ManageRoles, slowmode:P.ManageChannels,
  nick:P.ManageNicknames, cargo:P.ManageRoles, anunciar:P.ManageGuild,
  userinfo:P.ModerateMembers, serverinfo:P.ModerateMembers
};
const command = (name,description)=>new SlashCommandBuilder().setName(name).setDescription(description)
  .setDefaultMemberPermissions(commandPermissions[name]).setDMPermission(false);
const member = builder=>builder.addUserOption(o=>o.setName('membro').setDescription('Membro do servidor').setRequired(true));
const reason = (builder,required=false)=>builder.addStringOption(o=>o.setName('motivo').setDescription('Motivo da ação').setMaxLength(400).setRequired(required));

export const commands = [
  command('painel','Publica o painel de suporte e compras neste canal.'),
  reason(member(command('ban','Bane um membro do servidor.')),true),
  reason(command('unban','Remove um banimento pelo ID do usuário.').addStringOption(o=>o.setName('id').setDescription('ID do usuário banido').setRequired(true).setMinLength(17).setMaxLength(20))),
  reason(member(command('kick','Expulsa um membro do servidor.')),true),
  reason(member(command('timeout','Aplica um castigo temporário.')).addStringOption(o=>o.setName('tempo').setDescription('Ex.: 30s, 10m, 2h ou 7d; máximo 28 dias').setRequired(true)),true),
  reason(member(command('untimeout','Remove o castigo temporário de um membro.'))),
  reason(member(command('warn','Registra uma advertência para um membro.')),true),
  member(command('warnings','Consulta as advertências de um membro.')),
  reason(member(command('clearwarn','Apaga as advertências de um membro.')),true),
  command('cleanup','Apaga até 100 mensagens recentes, sem apagar fixadas.').addIntegerOption(o=>o.setName('quantidade').setDescription('Quantidade de mensagens, de 1 a 100').setMinValue(1).setMaxValue(100).setRequired(true)),
  reason(command('lock','Bloqueia o envio padrão de mensagens neste canal.')),
  reason(command('unlock','Restaura o envio padrão anterior ao /lock.')),
  command('slowmode','Define o intervalo entre mensagens neste canal.').addIntegerOption(o=>o.setName('segundos').setDescription('De 0 a 21600; use 0 para desativar').setRequired(true).setMinValue(0).setMaxValue(21600)),
  reason(member(command('nick','Altera ou remove o apelido de um membro.')).addStringOption(o=>o.setName('apelido').setDescription('Novo apelido; deixe vazio para remover').setMaxLength(32))),
  command('cargo','Adiciona ou remove um cargo de um membro.').addSubcommand(s=>reason(member(s.setName('adicionar').setDescription('Adiciona um cargo.')).addRoleOption(o=>o.setName('cargo').setDescription('Cargo a adicionar').setRequired(true))))
    .addSubcommand(s=>reason(member(s.setName('remover').setDescription('Remove um cargo.')).addRoleOption(o=>o.setName('cargo').setDescription('Cargo a remover').setRequired(true)))),
  command('anunciar','Publica um anúncio personalizado em um canal de texto.').addChannelOption(o=>o.setName('canal').setDescription('Canal do anúncio').addChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement).setRequired(true))
    .addStringOption(o=>o.setName('titulo').setDescription('Escreva o título do anúncio').setMinLength(1).setMaxLength(256).setRequired(true))
    .addStringOption(o=>o.setName('mensagem').setDescription('Conteúdo do anúncio; use \\n para quebrar linhas').setMinLength(1).setMaxLength(4000).setRequired(true))
    .addStringOption(o=>o.setName('cor').setDescription('Cor hexadecimal, por exemplo: #5865F2 ou #FF0000').setMaxLength(7))
    .addStringOption(o=>o.setName('imagem').setDescription('Link HTTP/HTTPS da imagem grande do anúncio').setMaxLength(2048))
    .addStringOption(o=>o.setName('miniatura').setDescription('Link HTTP/HTTPS da imagem pequena no canto').setMaxLength(2048))
    .addStringOption(o=>o.setName('rodape').setDescription('Texto do rodapé; se não preencher, fica oculto').setMaxLength(1000))
    .addStringOption(o=>o.setName('autor').setDescription('Nome exibido no topo do anúncio').setMaxLength(256))
    .addStringOption(o=>o.setName('icone_autor').setDescription('Link HTTP/HTTPS do ícone; precisa preencher autor').setMaxLength(2048))
    .addStringOption(o=>o.setName('icone_rodape').setDescription('Link HTTP/HTTPS do ícone; precisa preencher rodape').setMaxLength(2048))
    .addStringOption(o=>o.setName('link').setDescription('Link HTTP/HTTPS aberto ao clicar no título').setMaxLength(2048))
    .addBooleanOption(o=>o.setName('data').setDescription('Exibir data e horário no rodapé (padrão: não)')),
  member(command('userinfo','Mostra informações sobre um membro.')),
  command('serverinfo','Mostra informações sobre o servidor.')
];
