import { createAppServer } from './app.js';

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? '3000');

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PORT должен быть целым числом от 0 до 65535.');
  process.exitCode = 1;
} else {
  const server = createAppServer();
  server.once('error', (error) => {
    console.error(error.code === 'EADDRINUSE'
      ? `Порт ${port} уже занят. Укажите другой PORT.`
      : 'Не удалось запустить локальный сервер.');
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`Мониторинг интеграций — http://${host}:${server.address().port}`);
  });
}
