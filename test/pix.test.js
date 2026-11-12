import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { buildPixPayload, createPixPayment, crc16, pixAmount } from '../src/pix.js';

const key='123e4567-e12b-12d1-a456-426655440000';
const receiver={key,receiverName:'Fulano de Tal',receiverCity:'Brasília'};

function fields(text) {
  const result={};
  for (let offset=0;offset<text.length;) {
    const id=text.slice(offset,offset+2);
    const size=Number(text.slice(offset+2,offset+4));
    assert.ok(Number.isFinite(size));
    result[id]=text.slice(offset+4,offset+4+size);
    assert.equal(result[id].length,size);
    offset+=4+size;
    assert.ok(offset<=text.length);
  }
  return result;
}

test('CRC confere com o exemplo oficial do Banco Central e vetor CRC16-CCITT',()=>{
  // Manual de Padrões para Iniciação do Pix, seção 2.6.3.
  const example='00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
  assert.equal(crc16(example),'1D3D');
  assert.equal(crc16('123456789'),'29B1');
});

test('valor brasileiro é convertido sem arredondamento ou confusão de centavos',()=>{
  for (const [input,expected] of [['R$ 29,90','29.90'],['00,01','0.01'],['1.234,56','1234.56'],['29.90','29.90'],['29','29.00'],['1.000','1000.00'],['0,1','0.10']]) assert.equal(pixAmount(input),expected);
  for (const input of ['0','-10','Grátis','R$ 2,999','1,234.56','1e3','10.001,50x','9999999999999999']) assert.throws(()=>pixAmount(input));
});

test('BR Code contém a chave exata, valor, moeda, cidade e referência do ticket',()=>{
  const payload=buildPixPayload({...receiver,amount:'R$ 29,90',txid:'T123456789012345678'});
  const decoded=fields(payload);
  assert.equal(decoded['00'],'01');
  assert.equal(fields(decoded['26'])['00'],'br.gov.bcb.pix');
  assert.equal(fields(decoded['26'])['01'],key);
  assert.equal(decoded['53'],'986');
  assert.equal(decoded['54'],'29.90');
  assert.equal(decoded['58'],'BR');
  assert.equal(decoded['59'],'FULANO DE TAL');
  assert.equal(decoded['60'],'BRASILIA');
  assert.equal(fields(decoded['62'])['05'],'T123456789012345678');
  assert.equal(decoded['63'],crc16(payload.slice(0,-4)));
});

test('não gera cobrança com chave, cidade ou referência inválida',()=>{
  for (const extra of [{key:'chave qualquer'},{key:'https://example.com'},{receiverCity:''},{receiverName:'😀'},{txid:'ticket-123'},{txid:'A'.repeat(26)},{amount:'0,00'}]) {
    assert.throws(()=>buildPixPayload({...receiver,...extra}));
  }
  assert.equal(fields(buildPixPayload(receiver))['54'],undefined);
});

test('PNG do QR Code é legível e decodifica exatamente para o Pix Copia e Cola',async()=>{
  const result=await createPixPayment({pixKey:key,receiverName:'João da Silva',receiverCity:'São Paulo',price:'R$ 29,90'},'123456789012345678');
  assert.equal(result.file.name,'pix.png');
  const image=PNG.sync.read(result.file.attachment);
  assert.equal(image.width,512);
  const scanned=jsQR(new Uint8ClampedArray(image.data),image.width,image.height);
  assert.ok(scanned,'A imagem precisa ser lida como QR Code');
  assert.equal(scanned.data,result.payload);
  assert.equal(result.amount,'29.90');
  assert.equal(fields(fields(scanned.data)['26'])['01'],key);
});
