export interface SampleRecipeTemplate {
  id: string;
  label: string;
  sourceLabel: string;
  servingsLabel: string;
  coverImageUrl: string;
  rawText: string;
}

export const SAMPLE_RECIPES: SampleRecipeTemplate[] = [
  {
    id: 'spezzatino',
    label: 'Spezzatino di manzo con patate',
    sourceLabel: 'Ricetta tradizionale · 4 porzioni',
    servingsLabel: '4 porzioni',
    coverImageUrl: '/src/assets/images/sample_spezzatino_patate_1795433796516.jpg',
    rawText: `Spezzatino di manzo con patate (4 porzioni)
Preparazione: 15 min | Cottura: 65 min

Ingredienti:
- 600 g polpa di manzo (cappello del prete) a cubetti di 3 cm
- 450 g patate a pasta gialla a cubetti
- 1 cipolla dorata (100 g)
- 1 carota (80 g)
- 1 costa di sedano (50 g)
- 40 g olio extravergine d'oliva
- 100 ml vino rosso corposo
- 350 ml brodo di carne caldo
- 2 cucchiai di concentrato di pomodoro (30 g)
- 20 g farina 00 per infarinare la carne
- 1 rametto di rosmarino
- 8 g sale fino
- 2 g pepe nero macinato

Procedimento (stile Bimby/tradizionale):
1. Mettere cipolla, carota e sedano nel boccale e tritare 5 sec / Vel. 5.
2. Aggiungere 40 g di olio EVO e fare il soffritto: 4 min / 120°C / Vel. 1.
3. Unire la carne infarinata e rosolare 6 min / 120°C / Antiorario / Vel. 1.
4. Sfumare con il vino rosso 3 min / 100°C / Antiorario / Vel. 1 senza misurino.
5. Aggiungere il concentrato di pomodoro, il brodo caldo, il rosmarino, sale e pepe. Cuocere 40 min / 95°C / Antiorario / Vel. 1.
6. Unire le patate a cubetti e proseguire la cottura per 20 min / 95°C / Antiorario / Vel. 1 finché la carne è tenera e le patate sono integre.`,
  },
  {
    id: 'risotto-porcini',
    label: 'Risotto ai funghi porcini',
    sourceLabel: 'Ricetta tradizionale · 4 porzioni',
    servingsLabel: '4 porzioni',
    coverImageUrl: '/src/assets/images/sample_risotto_porcini_1795433796808.jpg',
    rawText: `Risotto ai funghi porcini cremoso (4 porzioni)
Preparazione: 15 min | Cottura: 25 min

Ingredienti:
- 320 g riso Carnaroli
- 300 g funghi porcini freschi puliti e affettati (oppure 35 g porcini secchi reidratati)
- 1 scalogno (40 g)
- 1 spicchio d'aglio
- 35 g olio extravergine d'oliva
- 80 ml vino bianco secco
- 850 ml brodo vegetale caldo
- 40 g burro freddo a cubetti
- 60 g Parmigiano Reggiano grattugiato
- 8 g sale fino
- 1 ciuffo di prezzemolo fresco tritato

Procedimento:
1. Tritare lo scalogno e l'aglio 4 sec / Vel. 5, raccogliere sul fondo.
2. Aggiungere l'olio EVO e rosolare 3 min / 120°C / Vel. 1.
3. Aggiungere i funghi porcini e insaporire 4 min / 120°C / Antiorario / Vel. 1.
4. Unire il riso Carnaroli e tostare 3 min / 120°C / Antiorario / Vel. 1 senza misurino.
5. Sfumare con vino bianco 2 min / 100°C / Antiorario / Vel. 1 senza misurino.
6. Versare il brodo vegetale caldo e il sale, cuocere 14 min / 100°C / Antiorario / Vel. 1 con cestello al posto del misurino.
7. Mantecare a motore fermo o lentissimo con burro freddo, Parmigiano e prezzemolo per 1 min / Antiorario / Vel. 1.`,
  },
  {
    id: 'ragu-bolognese',
    label: 'Ragù alla bolognese classico',
    sourceLabel: 'Ricetta tradizionale · 4 porzioni',
    servingsLabel: '4 porzioni',
    coverImageUrl: '/src/assets/images/sample_ragu_bolognese_1795433797508.jpg',
    rawText: `Ragù alla bolognese tradizionale (4 porzioni)
Preparazione: 15 min | Cottura: 75 min

Ingredienti:
- 400 g macinato misto di manzo e maiale
- 100 g pancetta tesa a cubetti piccoli
- 1 cipolla (80 g)
- 1 carota (70 g)
- 1 costa di sedano (50 g)
- 30 g olio extravergine d'oliva
- 100 ml vino rosso secco
- 400 g passata di pomodoro rustica
- 100 ml latte intero
- 100 ml brodo di carne
- 8 g sale fino
- 2 g pepe nero e un pizzico di noce moscata

Procedimento:
1. Tritare finemente cipolla, carota, sedano e pancetta per 6 sec / Vel. 6.
2. Aggiungere l'olio EVO e soffriggere 5 min / 120°C / Vel. 1.
3. Unire la carne macinata e rosolare bene 8 min / 120°C / Antiorario / Vel. 1.
4. Sfumare con il vino rosso 4 min / 100°C / Antiorario / Vel. 1 senza misurino.
5. Aggiungere passata di pomodoro, brodo, sale, pepe e noce moscata. Cuocere 55 min / 95°C / Antiorario / Vel. 1.
6. Negli ultimi 10 minuti aggiungere il latte intero per ammorbidire l'acidità del pomodoro.`,
  },
];
