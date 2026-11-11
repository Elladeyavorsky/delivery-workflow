# La versión de apm.yml crea la etiqueta

Cada vez que `staging` entra en `main`, el workflow `release.yml` crea la etiqueta `vX.Y.Z` y su release con la `version` de `apm.yml`. El número lo elige a mano quien prepara la versión, en un commit `chore: release X.Y.Z` en `staging`. Una comprobación en la pull request a `main` falla si esa versión ya tiene etiqueta o es menor que la última.

Se descartó release-please, que calcula la versión a partir de los conventional commits: abre su propia pull request contra `main`, así que `main` tendría commits que `staging` no tiene y habría que llevar `main` a `staging` después de cada versión.

## Consecuencias

- Nadie etiqueta a mano. Las etiquetas `v0.0.1` y `v0.1.0` son de antes del workflow y se quedan como están.
- Si alguien olvida subir la versión, la pull request a `main` no pasa la comprobación. Un push directo a `main` sin subirla hace fallar el workflow y no crea nada.
- La etiqueta y la release las crea `GITHUB_TOKEN` del propio workflow, con `contents: write`. Los workflows no se lanzan por etiquetas creadas así.
- La comprobación vive en `.github/scripts/release-version.sh`, que también se puede lanzar en local y tiene tests.
