# Kokki-Tomin räiskyvät räiskäleet

Selainpeli: Kokki-Tomi paistaa räiskäleitä. Käännä ne paistinpannulla ja heitä kypsät pinoon isolle vaaleanpunaiselle lautaselle. Ei riippuvuuksia, ei build-vaihetta.

## Säännöt
- Räiskäle paistuu molemmilta puolilta. Vihreä alue mittarissa = kypsä, punainen = palanut.
- **Käännä** (Väli / ↑): paina kun mittarin viisari on vihreällä alueella. Ikkuna kapenee pinon kasvaessa.
- **Heitä** (Enter / ↓): lennätä räiskäle lautaselle. Tähtää vaaleanpunaisen merkin kohdalle, lautanen liikkuu.
- Raaka (vain toinen puoli kypsä) räiskäle tarjolle = radikaali virhe, peli päättyy heti.
- Palanut, pudonnut tai ohi lautasen = menetät yhden kolmesta elämästä.
- Huono osuma huojuttaa pinoa, liian huojuva pino kaatuu.
- Pisteet: 10 / räiskäle, +5 täydellisesti paistetusta.

Taustamusiikki: koodilla syntetisoitu bluesrokki-shuffle (särökitara, basso, rummut, soolo-lickit). Käynnistyy ensimmäisestä klikkauksesta tai näppäimestä.

Muut näppäimet: T tulostaulu, M äänet ja musiikki pois/päälle, P tauko. Toimii myös hiirellä ja kosketuksella.

## Julkaisu GitHub Pagesiin
1. Luo GitHubissa uusi repo `raiskale` ja työnnä tämän kansion sisältö sinne (`main`-haara).
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Workflow `pages.yml` julkaisee `public/`-kansion. Osoite: `https://<käyttäjätunnus>.github.io/raiskale/`

## Rajoitus
Tulostaulu tallentuu pelaajan omaan selaimeen (localStorage). Yhteinen tulostaulu vaatisi palvelimen ja huijauksen eston.

Lisenssi: katso LICENSE.
