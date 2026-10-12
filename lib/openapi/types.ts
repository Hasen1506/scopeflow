/** A workstream's additions to the OpenAPI document served at /api/openapi. */
export type OpenApiFragment = {
  /** OpenAPI path items keyed by path ('/api/...'). A path may appear in one fragment only. */
  paths: Record<string, unknown>;
  /** Component schemas keyed by name. A name may appear in one fragment only. */
  schemas: Record<string, unknown>;
};
