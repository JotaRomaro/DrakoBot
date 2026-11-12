import QRCode from 'qrcode';

export function crc16(text) {
  let crc=0xffff;
  for (const byte of Buffer.from(text,'utf8')) {
    crc^=byte<<8;
    for (let bit=0;bit<8;bit++) crc=(crc & 0x8000 ? (crc<<1)^0x1021 : crc<<1)&0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4,'0');
}

export function pixAmount(price) {
  let value=price.trim().replace(/^R\$\s*/i,'');
  if (value.includes(',')) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(value)) throw new Error('Valor Pix inválido. Use um valor como R$ 29,90.');
    value=value.replace(/\./g,'').replace(',','.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(value)) value=value.replace(/\./g,'');
  else if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Valor Pix inválido. Use um valor como R$ 29,90.');
  const [whole,decimal='']=value.split('.');
  const cents=BigInt(whole)*100n+BigInt(decimal.padEnd(2,'0'));
  if (cents<1n || cents>999999999999n) throw new Error('O valor Pix deve ser positivo e caber no limite do BR Code.');
  return (cents/100n).toString()+'.'+(cents%100n).toString().padStart(2,'0');
}

function field(id,value) {
  const size=Buffer.byteLength(value,'utf8');
  if (size>99) throw new Error('Campo Pix excede o limite do BR Code.');
  return id+String(size).padStart(2,'0')+value;
}

function merchantText(value,limit,label) {
  const text=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()
    .replace(/[^A-Z0-9 $%*+\-./:]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit).trim();
  if (!text) throw new Error('Preencha '+label+' do recebedor para gerar o QR Code Pix.');
  return text;
}

export function buildPixPayload({key,receiverName,receiverCity,amount=null,txid='***'}) {
  const pixKey=key.trim();
  const validKey=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(pixKey)
    || /^\d{11}$|^\d{14}$|^\+[1-9]\d{7,14}$/.test(pixKey)
    || /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(pixKey);
  if (!validKey || pixKey.length>77) throw new Error('Chave Pix inválida para o QR Code.');
  if (txid!=='***' && !/^[A-Za-z0-9]{1,25}$/.test(txid)) throw new Error('Identificador Pix inválido.');
  const name=merchantText(receiverName,25,'o nome');
  const city=merchantText(receiverCity,15,'a cidade');
  const merchant=field('00','br.gov.bcb.pix')+field('01',pixKey);
  const payload=field('00','01')+field('26',merchant)+field('52','0000')+field('53','986')
    +(amount===null ? '' : field('54',pixAmount(amount)))+field('58','BR')
    +field('59',name)+field('60',city)+field('62',field('05',txid))+'6304';
  return payload+crc16(payload);
}

export async function createPixPayment(vip,reference) {
  const amount=pixAmount(vip.price);
  const payload=buildPixPayload({key:vip.pixKey,receiverName:vip.receiverName,receiverCity:vip.receiverCity,amount,txid:reference ? 'T'+reference : '***'});
  const png=await QRCode.toBuffer(payload,{type:'png',errorCorrectionLevel:'M',width:512,margin:4,color:{dark:'#000000',light:'#ffffff'}});
  return {payload,amount,file:{attachment:png,name:'pix.png'}};
}
