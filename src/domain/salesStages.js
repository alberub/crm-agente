const SALES_STAGE_CATALOG = [
  {
    code: "nuevo",
    name: "Nuevo",
    sortOrder: 10,
    isClosedWon: false,
    isClosedLost: false,
  },
  {
    code: "contactado",
    name: "Contactado",
    sortOrder: 20,
    isClosedWon: false,
    isClosedLost: false,
  },
  {
    code: "interesado",
    name: "Interesado",
    sortOrder: 30,
    isClosedWon: false,
    isClosedLost: false,
  },
  {
    code: "propuesta_enviada",
    name: "Propuesta enviada",
    sortOrder: 40,
    isClosedWon: false,
    isClosedLost: false,
  },
  {
    code: "ganado",
    name: "Ganado",
    sortOrder: 50,
    isClosedWon: true,
    isClosedLost: false,
  },
  {
    code: "perdido",
    name: "Perdido",
    sortOrder: 60,
    isClosedWon: false,
    isClosedLost: true,
  },
];

module.exports = {
  SALES_STAGE_CATALOG,
};
