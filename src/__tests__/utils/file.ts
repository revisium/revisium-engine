import { readFileSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';

export function createExpressFile(): Express.Multer.File {
  return {
    buffer: Buffer.from('data'),
    mimetype: 'text/plain',
    size: 4,
    fieldname: 'file',
    originalname: 'original-name.txt',
    encoding: '',
    stream: null as unknown as Readable,
    destination: '',
    filename: 'name',
    path: '',
  };
}

export function createExpressImageFile(): Express.Multer.File {
  const filePath = join(__dirname, './logo.png');
  const buffer = readFileSync(filePath);

  return {
    buffer,
    mimetype: 'image/png',
    size: buffer.length,
    fieldname: 'file',
    originalname: `logo.png`,
    encoding: '7bit',
    stream: null as unknown as Readable,
    destination: '',
    filename: `logo.png`,
    path: '',
  };
}
