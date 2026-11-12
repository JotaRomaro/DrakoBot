import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnnouncement } from '../src/announcement.js';

const options = values=>({getString:name=>values[name] ?? null,getBoolean:name=>values[name] ?? null});

test('anúncio básico mantém conteúdo e não adiciona rodapé ou data obrigatórios',()=>{
  const embed=buildAnnouncement(options({mensagem:'Primeira linha\\nSegunda linha'})).toJSON();
  assert.equal(embed.title,'📢 Comunicado');
  assert.equal(embed.description,'Primeira linha\nSegunda linha');
  assert.equal(embed.color,0x5865f2);
  assert.equal(embed.footer,undefined);
  assert.equal(embed.timestamp,undefined);
});

test('todos os campos do anúncio podem ser personalizados',()=>{
  const embed=buildAnnouncement(options({
    mensagem:'**Novidades**',titulo:'Atualização',cor:'#00FF88',
    imagem:'https://example.com/banner.png',miniatura:'https://example.com/logo.png',
    autor:'Equipe',icone_autor:'https://example.com/autor.png',
    rodape:'Servidor',icone_rodape:'https://example.com/rodape.png',
    link:'https://example.com/novidades',data:true
  })).toJSON();
  assert.equal(embed.title,'Atualização');
  assert.equal(embed.description,'**Novidades**');
  assert.equal(embed.color,0x00ff88);
  assert.equal(embed.image.url,'https://example.com/banner.png');
  assert.equal(embed.thumbnail.url,'https://example.com/logo.png');
  assert.deepEqual(embed.author,{name:'Equipe',icon_url:'https://example.com/autor.png',url:undefined});
  assert.equal(embed.footer.text,'Servidor');
  assert.equal(embed.footer.icon_url,'https://example.com/rodape.png');
  assert.equal(embed.url,'https://example.com/novidades');
  assert.ok(Number.isFinite(Date.parse(embed.timestamp)));
});

test('cores, links e ícones inválidos falham antes de publicar',()=>{
  for (const extra of [
    {cor:'#XYZXYZ'},{cor:'123'},{cor:'red'},{imagem:'arquivo.png'},
    {link:'javascript:alert(1)'},{miniatura:'ftp://example.com/logo.png'},
    {imagem:'https://usuario:senha@example.com/logo.png'},
    {icone_autor:'https://example.com/logo.png'},
    {icone_rodape:'https://example.com/logo.png'}
  ]) assert.throws(()=>buildAnnouncement(options({mensagem:'Aviso',...extra})));
  assert.throws(()=>buildAnnouncement(options({mensagem:'  '})),/vazio/);
  assert.equal(buildAnnouncement(options({mensagem:'Aviso',cor:'ff0000',data:false})).toJSON().color,0xff0000);
});
