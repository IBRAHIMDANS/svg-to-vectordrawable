import type { Config as SvgoConfig } from 'svgo';

/** A non-fatal issue encountered during conversion. */
export interface Warning {
    /** Stable machine-readable code, e.g. `unsupported-element`. */
    code: string;
    /** Human-readable explanation. */
    message: string;
    /** SVG element/attribute the warning relates to, when known. */
    node?: string;
}

export interface ConvertOptions {
    /**
     * Run svgo normalization first (inline styles, shapes→paths, bake transforms…).
     * Strongly recommended; it is what makes conversion robust across SVG sources.
     * @default true
     */
    optimize?: boolean;
    /** Override the svgo config used for normalization (only when `optimize` is true). */
    svgoConfig?: SvgoConfig;
    /** Decimal places kept for generated numbers (coordinates, radii). @default 3 */
    floatPrecision?: number;
    /** Concrete color substituted for `currentColor`. @default '#000000' */
    currentColor?: string;
    /**
     * SVG paints unfilled shapes black by default. When true, paths without an
     * explicit fill get `android:fillColor="#FF000000"`. @default true
     */
    fillBlackForUnfilled?: boolean;
    /** Throw on the first unsupported construct instead of warning. @default false */
    strict?: boolean;
    /** Indentation width (spaces). @default 4 */
    indent?: number;
    /** Prepend an XML declaration (`<?xml version="1.0" encoding="utf-8"?>`). @default false */
    xmlTag?: boolean;
    /** Add `android:tint` to the `<vector>`. Android color literal (e.g. `#AARRGGBB`), passed verbatim. */
    tint?: string;
    /** Called for every warning as it happens (in addition to the returned list). */
    onWarn?: (warning: Warning) => void;
}

export interface ConvertResult {
    /** The generated Android VectorDrawable XML. */
    xml: string;
    /** All non-fatal issues encountered. */
    warnings: Warning[];
}

/** An RGBA color expressed as Android `#AARRGGBB`. */
export type AndroidColor = `#${string}`;
