import type { TransformationStage } from './types';

/**
 * Generates DuckDB SQL from a transformation stage
 */
export function generateSQLFromStage(stage: TransformationStage, sourceTableName: string): string {
  switch (stage.type) {
    case 'JOIN': {
      if (!stage.data?.leftTable || !stage.data?.rightTable || !stage.data?.leftKey || !stage.data?.rightKey) {
        throw new Error('JOIN stage requires leftTable, rightTable, leftKey, and rightKey');
      }
      const joinType = stage.data.joinType || 'INNER';
      const joinKeyword = joinType === 'FULL OUTER' ? 'FULL OUTER JOIN' : `${joinType} JOIN`;
      
      // Use table aliases and EXCLUDE to avoid duplicate columns
      const leftAlias = 'l';
      const rightAlias = 'r';
      
      // If join keys have the same name, use USING clause to avoid duplication
      if (stage.data.leftKey === stage.data.rightKey) {
        return `SELECT ${leftAlias}.*, ${rightAlias}.* EXCLUDE (${stage.data.rightKey}) FROM ${stage.data.leftTable} ${leftAlias} ${joinKeyword} ${stage.data.rightTable} ${rightAlias} USING (${stage.data.leftKey})`;
      } else {
        // Different key names - select all from both with table prefixes
        return `SELECT ${leftAlias}.*, ${rightAlias}.* FROM ${stage.data.leftTable} ${leftAlias} ${joinKeyword} ${stage.data.rightTable} ${rightAlias} ON ${leftAlias}.${stage.data.leftKey} = ${rightAlias}.${stage.data.rightKey}`;
      }
    }

    case 'UNION': {
      if (!stage.data?.tables || stage.data.tables.length < 2) {
        throw new Error('UNION stage requires at least 2 tables');
      }
      const unionType = stage.data.unionType || 'UNION';
      const unionKeyword = unionType === 'UNION ALL' ? 'UNION ALL' : 'UNION';
      const tables = stage.data.tables;
      const selects = tables.map(t => `SELECT * FROM ${t}`).join(` ${unionKeyword} `);
      return selects;
    }

    case 'FILTER': {
      if (!stage.data?.table) {
        throw new Error('FILTER stage requires table name');
      }
      let whereClause = '';
      
      if (stage.data.conditions && stage.data.conditions.length > 0) {
        // Multiple conditions
        const conditions = stage.data.conditions.map((cond, idx) => {
          const logic = idx > 0 ? ` ${cond.logic || 'AND'} ` : '';
          const value = typeof cond.value === 'string' ? `'${cond.value.replace(/'/g, "''")}'` : cond.value;
          return `${logic}${cond.column} ${cond.operator} ${value}`;
        }).join('');
        whereClause = `WHERE ${conditions}`;
      } else if (stage.data?.column && stage.data?.operator && stage.data?.value !== undefined) {
        // Single condition
        const value = typeof stage.data.value === 'string' ? `'${stage.data.value.replace(/'/g, "''")}'` : stage.data.value;
        whereClause = `WHERE ${stage.data.column} ${stage.data.operator} ${value}`;
      } else {
        throw new Error('FILTER stage requires column, operator, and value, or conditions array');
      }
      
      return `SELECT * FROM ${stage.data.table} ${whereClause}`;
    }

    case 'GROUP': {
      if (!stage.data?.groupBy || stage.data.groupBy.length === 0) {
        throw new Error('GROUP stage requires groupBy array');
      }
      const groupBy = stage.data.groupBy.join(', ');
      let selectClause = groupBy;
      
      if (stage.data.aggregations && stage.data.aggregations.length > 0) {
        const aggs = stage.data.aggregations.map(agg => {
          const alias = agg.alias ? ` AS ${agg.alias}` : '';
          return `${agg.function}(${agg.column})${alias}`;
        }).join(', ');
        selectClause = `${groupBy}, ${aggs}`;
      }
      
      const sourceTable = stage.data.table || sourceTableName;
      return `SELECT ${selectClause} FROM ${sourceTable} GROUP BY ${groupBy}`;
    }

    case 'SELECT': {
      if (!stage.data?.columns || stage.data.columns.length === 0) {
        throw new Error('SELECT stage requires columns array');
      }
      const columns = stage.data.columns.join(', ');
      const sourceTable = stage.data.table || sourceTableName;
      return `SELECT ${columns} FROM ${sourceTable}`;
    }

    case 'SORT': {
      if (!stage.data?.orderBy || stage.data.orderBy.length === 0) {
        throw new Error('SORT stage requires orderBy array');
      }
      const orderBy = stage.data.orderBy.map(o => `${o.column} ${o.direction}`).join(', ');
      const sourceTable = stage.data.table || sourceTableName;
      return `SELECT * FROM ${sourceTable} ORDER BY ${orderBy}`;
    }

    case 'CUSTOM': {
      if (!stage.data?.sql) {
        throw new Error('CUSTOM stage requires sql string');
      }
      return stage.data.sql;
    }

    case 'AGGREGATE': {
      // Similar to GROUP but without GROUP BY
      if (!stage.data?.aggregations || stage.data.aggregations.length === 0) {
        throw new Error('AGGREGATE stage requires aggregations array');
      }
      const aggs = stage.data.aggregations.map(agg => {
        const alias = agg.alias ? ` AS ${agg.alias}` : '';
        return `${agg.function}(${agg.column})${alias}`;
      }).join(', ');
      const sourceTable = stage.data.table || sourceTableName;
      return `SELECT ${aggs} FROM ${sourceTable}`;
    }

    default:
      throw new Error(`Unsupported stage type: ${stage.type}`);
  }
}

