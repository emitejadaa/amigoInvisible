# amigoInvisible

App simple para hacer el sorteo de amigo invisible en tiempo real, desde el celular.

Un admin crea una sala y recibe un código. Los demás se unen con ese código desde su
dispositivo. Cuando el admin presiona **Realizar sorteo**, cada participante recibe
en su propia pantalla, **en privado**, el nombre de la persona a la que le tiene que regalar.

## Funcionalidades

- El admin crea la sala y puede elegir si participa o no del sorteo.
- Los participantes se unen por código, sin necesidad de login.
- Lista de participantes en vivo (Supabase Realtime).
- El admin puede expulsar participantes antes del sorteo.
- Al sortear, cada persona ve **solo** su propio resultado; nadie más puede verlo.
- El sorteo evita que a alguien le toque regalarse a sí mismo (derangement).

## Arquitectura

Es un sitio **estático** (HTML/CSS/JS plano) desplegable en Vercel, con
[Supabase](https://supabase.com) como backend:

- **Postgres** guarda salas, participantes y asignaciones.
- **Supabase Realtime** sincroniza en vivo la lista de participantes y el estado de la sala.
- **Edge Function `amigo`** contiene toda la lógica sensible (crear/unirse/echar/sortear/ver
  resultado) y corre con la *service role key*.

### Seguridad del secreto

Las tablas de secretos (`room_secrets`, `participant_tokens`) y de resultados
(`assignments`) tienen Row Level Security que **bloquea toda lectura desde el cliente**.
La única forma de conocer a quién te tocó es llamar a la Edge Function con tu token
secreto, que devuelve exclusivamente tu propia asignación. Ni siquiera el admin puede
ver las asignaciones ajenas.

## Configuración

`config.js` contiene la URL del proyecto Supabase y la *anon key* (ambas son públicas
por diseño). Si clonás esto en tu propio Supabase, actualizá esos valores y desplegá la
Edge Function que está en `supabase/functions/amigo/`.

## Deploy

Es estático: cualquier hosting de archivos estáticos sirve. En Vercel, deploy directo
sin build (framework: "Other" / ninguno).
