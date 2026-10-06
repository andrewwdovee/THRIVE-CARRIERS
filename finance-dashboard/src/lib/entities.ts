export type EntityId = "thrive" | "leadtech";

export interface Entity {
  id: EntityId;
  name: string;
  short: string;
  description: string;
  /** CSS custom property holding this entity's identity color. */
  colorVar: string;
}

export const ENTITIES: Entity[] = [
  {
    id: "thrive",
    name: "Thrive Companies",
    short: "Thrive",
    description: "Life insurance brokerage",
    colorVar: "--entity-thrive",
  },
  {
    id: "leadtech",
    name: "Lead Tech",
    short: "Lead Tech",
    description: "Lead generation company",
    colorVar: "--entity-leadtech",
  },
];

export function getEntity(id: string): Entity | undefined {
  return ENTITIES.find((e) => e.id === id);
}

export function isEntityId(id: string): id is EntityId {
  return ENTITIES.some((e) => e.id === id);
}
