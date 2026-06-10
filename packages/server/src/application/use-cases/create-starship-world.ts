// Back-compat shim (Phase B, B5). createStarshipWorld was renamed
// createBoundedWorld and made archetype-driven; this re-export keeps existing
// importers (and the legacy creation action/UI) working until the concealed
// onboarding path (B6) replaces them. Prefer importing from create-bounded-world.
export {
  createBoundedWorld as createStarshipWorld,
  type CreateBoundedWorldDeps as CreateStarshipWorldDeps,
  type CreateBoundedWorldInput as CreateStarshipWorldInput,
  type CreateBoundedWorldResult as CreateStarshipWorldResult,
} from '@/application/use-cases/create-bounded-world'
