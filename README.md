# amigoInvisible

App simple para hacer el sorteo de amigo invisible en tiempo real.

Un admin crea una sala y recibe un código. Los demás se unen desde su celular con ese código.
Cuando el admin presiona "Realizar sorteo", cada participante recibe en su propio dispositivo,
en privado, el nombre de la persona a la que le tiene que regalar.

## Funcionalidades

- El admin crea la sala y puede decidir si participa o no del sorteo.
- Los participantes se unen por código, sin necesidad de login.
- Lista de participantes en vivo (vía WebSockets).
- El admin puede expulsar participantes de la sala antes del sorteo.
- Al sortear, cada persona ve solo su propio resultado en su pantalla; nadie más lo ve.

## Cómo correrla

```bash
npm install
npm start
```

Por defecto queda disponible en `http://localhost:3000`. Cada participante abre esa URL
desde su celular (en la misma red, o publicando el server en algún hosting) y se une con el código de sala.

## Stack

Node.js + Express + Socket.IO en el backend, HTML/CSS/JS plano en el frontend. Todo el
estado de las salas vive en memoria del proceso (pensado para un evento puntual, no
requiere base de datos).
