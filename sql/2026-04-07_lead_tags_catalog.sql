BEGIN;

CREATE TABLE IF NOT EXISTS public.cat_tags (
  id BIGSERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  categoria TEXT NOT NULL DEFAULT 'interes',
  color TEXT NOT NULL DEFAULT 'gray',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  marketing_habilitado BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.lead_tags (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES public.lead(id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES public.cat_tags(id) ON DELETE CASCADE,
  origen TEXT NOT NULL DEFAULT 'manual',
  confianza NUMERIC(4,3) NULL,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_tags_origen_check
    CHECK (origen IN ('manual', 'ia', 'sistema')),
  CONSTRAINT lead_tags_confianza_check
    CHECK (confianza IS NULL OR (confianza >= 0 AND confianza <= 1)),
  CONSTRAINT lead_tags_lead_tag_unique
    UNIQUE (lead_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_cat_tags_activo_categoria
  ON public.cat_tags (activo, categoria, nombre);

CREATE INDEX IF NOT EXISTS idx_cat_tags_marketing
  ON public.cat_tags (marketing_habilitado, activo);

CREATE INDEX IF NOT EXISTS idx_lead_tags_lead
  ON public.lead_tags (lead_id, fecha_creacion DESC);

CREATE INDEX IF NOT EXISTS idx_lead_tags_tag
  ON public.lead_tags (tag_id, fecha_creacion DESC);

CREATE INDEX IF NOT EXISTS idx_lead_tags_origen
  ON public.lead_tags (origen);

DO $$
BEGIN
  IF to_regclass('public.lead_tag') IS NOT NULL THEN
    INSERT INTO public.cat_tags (nombre, slug, categoria, color, marketing_habilitado)
    SELECT
      MIN(normalized.tag_name) AS tag_name,
      normalized.tag_slug,
      'interes',
      'gray',
      TRUE
    FROM (
      SELECT
        NULLIF(TRIM(tag), '') AS tag_name,
        NULLIF(
          REGEXP_REPLACE(
            REGEXP_REPLACE(LOWER(TRIM(tag)), '[^[:alnum:]]+', '_', 'g'),
            '^_+|_+$',
            '',
            'g'
          ),
          ''
        ) AS tag_slug
      FROM public.lead_tag
    ) AS normalized
    WHERE normalized.tag_name IS NOT NULL
      AND normalized.tag_slug IS NOT NULL
    GROUP BY normalized.tag_slug
    ON CONFLICT (slug) DO UPDATE
    SET nombre = EXCLUDED.nombre;

    INSERT INTO public.lead_tags (lead_id, tag_id, origen, confianza, fecha_creacion)
    SELECT
      legacy.lead_id,
      catalog.id,
      'manual',
      NULL,
      legacy.created_at
    FROM (
      SELECT
        lead_id,
        created_at,
        NULLIF(
          REGEXP_REPLACE(
            REGEXP_REPLACE(LOWER(TRIM(tag)), '[^[:alnum:]]+', '_', 'g'),
            '^_+|_+$',
            '',
            'g'
          ),
          ''
        ) AS tag_slug
      FROM public.lead_tag
      WHERE NULLIF(TRIM(tag), '') IS NOT NULL
    ) AS legacy
    JOIN public.cat_tags catalog
      ON catalog.slug = legacy.tag_slug
    WHERE legacy.tag_slug IS NOT NULL
    ON CONFLICT (lead_id, tag_id) DO NOTHING;
  END IF;
END $$;

COMMIT;
