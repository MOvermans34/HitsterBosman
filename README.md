# Hitser op z'n Bosmans – muziek-tijdlijnspel op afstand

Raad uit welk jaar een nummer komt en bouw zo je eigen tijdlijn. Iedereen speelt op zijn eigen telefoon of laptop, en de muziek komt uit jullie Spotify-playlists.

## Hoe het werkt
- De **spelleider** maakt een kamer aan, koppelt Spotify en kiest de playlists.
- **Vrienden** doen mee met een code van 4 letters of via de uitnodigingslink. Ze hebben geen account nodig.
- **Muziek horen**, op twee manieren:
  1. De spelleider deelt in Discord, Google Meet of Zoom het scherm of tabblad **met geluid**.
  2. Wie Spotify Premium heeft én door de spelleider is toegevoegd aan de Spotify-app, klikt op *Koppel Spotify*. Het nummer start dan automatisch op zijn eigen apparaat.
- Wie aan de beurt is, vult eerst **artiest en titel** in en legt daarna de kaart op de juiste plek in de tijdlijn. De anderen zien live mee.
- Artiest én titel goed levert automatisch +1 munt op. Kleine typfouten, hoofdletters, "The" en toevoegingen als "(Remastered)" tellen niet mee. Was het antwoord bijna goed, dan kan een medespeler het toch goed rekenen.
- Met 1 munt ruil je een nummer in, met 3 munten koop je een kaart. Wie als eerste 10 kaarten heeft, wint.
- De spelleider kan namens een speler handelen (handig als iemands verbinding wegvalt) en kan een fout jaartal verbeteren.
- Verbinding kwijt of pagina herladen? Je komt automatisch terug in je kamer.

## Online zetten (gratis via Render)
1. Zet deze map in een (privé) GitHub-repository.
2. Ga naar https://render.com → **New → Web Service** en kies de repo.
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
3. Na het deployen krijg je een adres zoals `https://tijdmachine-xxxx.onrender.com`.
4. Optioneel: zet bij *Environment* de variabele `SPOTIFY_CLIENT_ID` op je Client ID. Dan hoeft niemand die in te vullen.

Let op: de gratis versie van Render valt na 15 minuten zonder bezoekers in slaap. De eerste keer laden kan dan zo'n 30 tot 60 seconden duren. Kamers worden alleen in het geheugen bewaard, dus na zo'n slaap zijn oude kamers weg. Tijdens een spel gebeurt dat niet.
Andere hosts met WebSocket-ondersteuning werken ook (Fly.io, Railway, een eigen VPS).

## Spotify instellen (eenmalig, door de spelleider)
1. Ga naar https://developer.spotify.com/dashboard → **Create app**. Vink **Web API** en **Web Playback SDK** aan.
2. Vul bij **Redirect URIs** het adres van je site in, met `/` erachter, bijvoorbeeld `https://tijdmachine-xxxx.onrender.com/`. De app toont het exacte adres zelf.
3. Zet bij **User Management** de Spotify-accounts van iedereen die zelf Spotify wil koppelen. In ontwikkelmodus zijn dat er maar een paar. Wie niet op de lijst staat, luistert mee via het videogesprek.
4. Plak de **Client ID** in de app, of zet hem als `SPOTIFY_CLIENT_ID` op de server.

Voorwaarde: de eigenaar van de Spotify-app en iedereen die via Spotify afspeelt, heeft **Spotify Premium**.

## Lokaal testen
```bash
npm install
npm start
```
Open daarna `http://127.0.0.1:8080/`. Gebruik `127.0.0.1` en niet `localhost`, want Spotify accepteert `localhost` niet als redirect. Zet ook `http://127.0.0.1:8080/` als Redirect URI in je Spotify-app.

## Bekende beperkingen
- Het jaar komt van het Spotify-album. Bij remasters en verzamelalbums klopt het soms niet. Verzamelalbums worden standaard overgeslagen. De spelleider kan met *Jaar klopt niet?* een jaar verbeteren, en dat wordt onthouden.
- Op telefoons kan de browser zelf geen Spotify afspelen. Kies dan de Spotify-app als apparaat en leg de telefoon omgekeerd neer, anders zie je de titel.
- Spotify laat hobby-apps vaak alleen playlists lezen die je zelf hebt gemaakt of waaraan je meewerkt. Kopieer een playlist van een ander zo nodig naar je eigen account.

## Bestanden
- `server.js`: kamers, spelregels en WebSocket-server
- `public/index.html`: de app voor de spelers
- `public/index-solo.html`: de eerdere versie voor één scherm, als je samen in één ruimte zit
