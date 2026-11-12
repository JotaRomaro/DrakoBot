import { EmbedBuilder } from 'discord.js';

function webURL(value, field) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Informe um link HTTP/HTTPS válido em '+field+'.'); }
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw new Error('Informe um link HTTP/HTTPS válido em '+field+'.');
  return url.href;
}

export function buildAnnouncement(options) {
  const content = options.getString('mensagem',true).replace(/\\n/g,'\n');
  if (!content.trim()) throw new Error('O conteúdo do anúncio não pode ficar vazio.');
  const title = options.getString('titulo')?.trim() || '📢 Comunicado';
  const color = options.getString('cor')?.trim() || '#5865F2';
  if (!/^#?[0-9a-f]{6}$/i.test(color)) throw new Error('Use uma cor hexadecimal com 6 caracteres, por exemplo: #5865F2.');
  const embed = new EmbedBuilder().setTitle(title).setDescription(content).setColor(parseInt(color.replace('#',''),16));
  for (const [field,method] of [['imagem','setImage'],['miniatura','setThumbnail'],['link','setURL']]) {
    const value=options.getString(field)?.trim();
    if (value) embed[method](webURL(value,field));
  }
  const author=options.getString('autor')?.trim();
  const authorIcon=options.getString('icone_autor')?.trim();
  const footer=options.getString('rodape')?.trim();
  const footerIcon=options.getString('icone_rodape')?.trim();
  if (authorIcon && !author) throw new Error('Preencha autor para usar icone_autor.');
  if (footerIcon && !footer) throw new Error('Preencha rodape para usar icone_rodape.');
  if (author) embed.setAuthor({name:author,...(authorIcon ? {iconURL:webURL(authorIcon,'icone_autor')} : {})});
  if (footer) embed.setFooter({text:footer,...(footerIcon ? {iconURL:webURL(footerIcon,'icone_rodape')} : {})});
  if (options.getBoolean('data')===true) embed.setTimestamp();
  // Valide antes de publicar, para que nenhum anúncio parcial seja enviado.
  embed.toJSON();
  if (embed.length>6000) throw new Error('O anúncio deve ter no máximo 6000 caracteres no total.');
  return embed;
}
