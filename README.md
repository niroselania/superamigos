# Super Amigos – juego de cartas en red

Microapp para jugar a las cartas de los Superamigos (edición DC Comics 1985) entre 2 o 3 personas, cada una desde su celular o compu.

## Cómo se juega
1. Uno crea una sala y pasa el código de 4 letras (o el link) a los demás.
2. El anfitrión toca **Repartir y empezar**: las 32 cartas se reparten parejo.
3. Cada jugador ve solo su carta de arriba. El que tiene el turno elige un atributo (altura, peso, fuerza, peleas ganadas o velocidad).
4. Se muestran las cartas de todos: **gana el valor más alto** y se lleva las cartas de los demás. El ganador sigue eligiendo.
5. Si hay empate en lo más alto, las cartas van a un pozo que se lleva quien gane la próxima ronda.
6. Quien se queda sin cartas sale. Gana quien junta las 32.

## Correrlo
```bash
npm install
npm start          # http://localhost:3000
```
En la misma red wifi, los demás entran a `http://IP-DE-TU-SERVIDOR:3000`.

Con Docker / Portainer:
```bash
docker compose up -d --build
```
Para jugar online hay que publicar el puerto 3000 detrás de un proxy inverso con HTTPS (el juego usa WebSocket en `/ws`; si usás Nginx Proxy Manager, activá "Websockets Support").

## Imágenes
Cada naipe es la foto real en `public/cards/` (un `.webp` por código, `A1.webp` … `H4.webp`). Son fotos de tus cartas físicas: usalas en tu red privada. Si vas a publicar el juego abierto en internet, tené en cuenta que los dibujos son de DC Comics.

## Datos
Las cartas están en `data/cards.json` (código A1–H4, nombre y 5 atributos). Si algún número no coincide con tu carta, se corrige ahí y se reinicia.

## Reglas configurables (en `server.js`)
- `MAX_PLAYERS`: máximo de jugadores por sala (3).
- Gana siempre el valor más alto, también en Altura y Peso.

## Prueba automática
`npm test` juega varias partidas completas con clientes simulados y verifica que no se pierda ni se duplique ninguna carta.
