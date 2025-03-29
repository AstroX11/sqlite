import { ModelDefinition } from '../Types.mjs';
import { snakeCase, formatDefaultValue, mapDataType } from './utils.js';

/**
 * Generates SQLite CREATE TABLE statement from a model definition
 *
 * @param def The model definition object
 * @returns A properly formatted SQLite CREATE TABLE statement
 */
export function generateCreateTableSQL(def: ModelDefinition): string {
  // Return early for virtual tables
  if (def.options?.virtual) {
    return generateVirtualTableSQL(def);
  }

  const columns: string[] = [];
  const tableConstraints: string[] = [];

  // Process column definitions
  for (const [name, attr] of Object.entries(def.attributes)) {
    const colName = def.options?.underscored ? snakeCase(name) : name;
    const type = mapDataType(attr.type);
    const parts = [colName, type];

    // Handle column constraints
    if (attr.primaryKey) {
      // Don't add PRIMARY KEY at column level if we have a composite primary key
      if (!def.options?.primaryKey || typeof def.options.primaryKey === 'string') {
        parts.push('PRIMARY KEY');
        if (attr.autoIncrement) parts.push('AUTOINCREMENT');
      }
    }

    if (attr.allowNull === false) parts.push('NOT NULL');

    if (attr.unique) {
      if (typeof attr.unique === 'boolean') {
        parts.push('UNIQUE');
      } else if (typeof attr.unique === 'string') {
        tableConstraints.push(`CONSTRAINT ${attr.unique} UNIQUE (${colName})`);
      } else if (typeof attr.unique === 'object' && attr.unique.name) {
        tableConstraints.push(`CONSTRAINT ${attr.unique.name} UNIQUE (${colName})`);
      }
    }

    if (attr.defaultValue !== undefined) {
      parts.push(`DEFAULT ${formatDefaultValue(attr.defaultValue)}`);
    }

    if (attr.check) parts.push(`CHECK (${attr.check})`);

    // Add collation support for text columns
    if (type === 'TEXT' && attr.collate) {
      parts.push(`COLLATE ${attr.collate}`);
    }

    // Add generated column support
    if (attr.generated) {
      parts.push(
        `GENERATED ALWAYS AS (${attr.generated.expression}) ${
          attr.generated.stored ? 'STORED' : 'VIRTUAL'
        }`,
      );
    }

    // Foreign key reference
    if (attr.references) {
      parts.push(`REFERENCES ${attr.references.table}(${attr.references.column})`);
      if (attr.onDelete) parts.push(`ON DELETE ${attr.onDelete}`);
      if (attr.onUpdate) parts.push(`ON UPDATE ${attr.onUpdate}`);

      // Add SQLite deferrable constraint support
      if (attr.deferrable) {
        parts.push(`DEFERRABLE INITIALLY ${attr.deferred ? 'DEFERRED' : 'IMMEDIATE'}`);
      }
    }

    columns.push(parts.join(' '));
  }

  // Add composite primary key constraint if defined in options
  if (def.options?.primaryKey) {
    if (Array.isArray(def.options.primaryKey)) {
      tableConstraints.push(`PRIMARY KEY (${def.options.primaryKey.join(', ')})`);
    } else if (
      typeof def.options.primaryKey === 'string' &&
      !def.attributes[def.options.primaryKey]?.primaryKey
    ) {
      // Only add if not already defined at column level
      tableConstraints.push(`PRIMARY KEY (${def.options.primaryKey})`);
    }
  }

  // Add table-level constraints if present
  if (def.options?.constraints) {
    // Add table-level unique constraints
    if (def.options.constraints.unique) {
      for (const [name, fields] of Object.entries(def.options.constraints.unique)) {
        if (Array.isArray(fields) && fields.length > 0) {
          tableConstraints.push(`CONSTRAINT ${name} UNIQUE (${fields.join(', ')})`);
        }
      }
    }

    // Add table-level check constraints
    if (def.options.constraints.check) {
      for (const [name, expression] of Object.entries(def.options.constraints.check)) {
        tableConstraints.push(`CONSTRAINT ${name} CHECK (${expression})`);
      }
    }

    // Add table-level foreign key constraints
    if (def.options.constraints.foreignKey) {
      for (const [name, fk] of Object.entries(def.options.constraints.foreignKey)) {
        if (Array.isArray(fk.fields) && fk.fields.length > 0 && fk.references) {
          let constraint = `CONSTRAINT ${name} FOREIGN KEY (${fk.fields.join(', ')}) `;
          constraint += `REFERENCES ${fk.references.table}(${
            Array.isArray(fk.references.fields)
              ? fk.references.fields.join(', ')
              : fk.references.fields
          })`;

          if (fk.onDelete) constraint += ` ON DELETE ${fk.onDelete}`;
          if (fk.onUpdate) constraint += ` ON UPDATE ${fk.onUpdate}`;
          if (fk.deferrable) {
            constraint += ` DEFERRABLE INITIALLY ${fk.deferred ? 'DEFERRED' : 'IMMEDIATE'}`;
          }

          tableConstraints.push(constraint);
        }
      }
    }
  }

  // Combine columns and table constraints
  const allDefinitions = [...columns, ...tableConstraints];

  // Handle SQLite-specific table options
  const tableOptions = [
    def.options?.strict ? 'STRICT' : '',
    def.options?.withoutRowid ? 'WITHOUT ROWID' : '',
    def.options?.temporary ? 'TEMPORARY' : '',
  ].filter(Boolean);

  return `CREATE TABLE ${def.options?.ifNotExists ? 'IF NOT EXISTS ' : ''}${
    def.tableName
  } (${allDefinitions.join(', ')}) ${tableOptions.join(' ')}`.trim();
}

/**
 * Generates SQL for a virtual table (FTS5, rtree, etc.)
 *
 * @param def The model definition object
 * @returns A properly formatted CREATE VIRTUAL TABLE statement
 */
export function generateVirtualTableSQL(def: ModelDefinition): string {
  if (!def.options?.virtual) {
    throw new Error('Virtual table options are required');
  }

  return `CREATE VIRTUAL TABLE ${def.options?.ifNotExists ? 'IF NOT EXISTS ' : ''}${
    def.tableName
  } USING ${def.options.virtual.using} (${def.options.virtual.args?.join(', ') || ''})`;
}
