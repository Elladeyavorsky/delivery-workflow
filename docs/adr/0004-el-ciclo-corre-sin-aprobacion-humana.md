# El ciclo corre sin aprobación humana

Al dejar la tarea escrita, el ciclo escribe la spec, el plan y las tasks y sigue con las rondas sin esperar a que nadie los apruebe, igual que `exercises/ChromaDB` en `staging` («Llama y continúa. No espera un sí»). La persona revisa todo junto en la pull request. Se descartó parar después de la spec y después del plan hasta que la persona dé el visto bueno, como hacen las specs de `asistenciapp`: da más control, pero cada tarea pequeña se queda esperando y el flujo deja de parecerse al del curso.

## Consecuencias

- El ciclo solo para por su cuenta en tres casos: un hueco en la spec, un secreto en un fichero que toca y la novena ronda fallida.
- La línea `Estado · Creada · Aprobada` de la spec es un registro, no un cerrojo.
