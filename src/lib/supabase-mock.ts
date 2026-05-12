// Mock data storage
const mockData = {
  products: [
    {
      id: 1,
      name: 'Producto Demo 1',
      slug: 'producto-demo-1',
      price: 100,
      transfer_discount_pct: 5,
      stock: 50,
      low_stock_threshold: 10,
      active: true,
      featured: true,
      category_id: 1,
      created_at: new Date().toISOString(),
    },
    {
      id: 2,
      name: 'Producto Demo 2',
      slug: 'producto-demo-2',
      price: 200,
      transfer_discount_pct: 10,
      stock: 30,
      low_stock_threshold: 10,
      active: true,
      featured: false,
      category_id: 1,
      created_at: new Date().toISOString(),
    },
  ],
  categories: [
    { id: 1, name: 'Categoría 1', slug: 'categoria-1', image_url: null, parent_id: null, order: 1, active: true },
    { id: 2, name: 'Categoría 2', slug: 'categoria-2', image_url: null, parent_id: null, order: 2, active: true },
  ],
  product_images: [
    { id: 1, product_id: 1, url: 'https://via.placeholder.com/500', thumb_url: 'https://via.placeholder.com/200', order: 1, is_primary: true },
    { id: 2, product_id: 2, url: 'https://via.placeholder.com/500', thumb_url: 'https://via.placeholder.com/200', order: 1, is_primary: true },
  ],
  banners: [
    { id: 1, title: 'Banner Demo 1', subtitle: 'Subtítulo', image_url: 'https://via.placeholder.com/1200x400', link_url: '/', order: 1, active: true },
  ],
  orders: [],
  order_items: [],
  site_config: [{ key: 'store_name', value: 'Mi Tienda' }],
};

class MockQueryBuilder {
  _tableName: string;
  _data: any[];
  _filters: any[] = [];
  _selects: string[] | null = null;
  _order: any[] = [];
  _range: [number, number] | null = null;
  _limit: number | null = null;
  _single = false;
  _count: string | null = null;

  constructor(tableName: string) {
    this._tableName = tableName;
    this._data = JSON.parse(JSON.stringify(mockData[tableName as keyof typeof mockData] || []));
  }

  select(fields: string, options?: any): this {
    this._count = options?.count || null;
    this._selects = fields.split(',').map(f => f.trim());
    return this;
  }

  eq(field: string, value: any): this {
    this._filters.push({ field, op: 'eq', value });
    return this;
  }

  ilike(field: string, value: any): this {
    this._filters.push({ field, op: 'ilike', value });
    return this;
  }

  gte(field: string, value: any): this {
    this._filters.push({ field, op: 'gte', value });
    return this;
  }

  lte(field: string, value: any): this {
    this._filters.push({ field, op: 'lte', value });
    return this;
  }

  order(field: string, options?: any): this {
    this._order.push({ field, ascending: options?.ascending ?? true });
    return this;
  }

  range(from: number, to: number): this {
    this._range = [from, to];
    return this;
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  single(): this {
    this._single = true;
    return this;
  }

  private loadRelations(row: any, selects: string[]): any {
    const result = { ...row };
    for (const select of selects) {
      if (select.includes('(')) {
        const [relationName, _fields] = select.split('(');
        const cleanRelation = relationName.trim();

        if (cleanRelation === 'categories' && mockData.categories) {
          result.categories = mockData.categories.find(c => c.id === row.category_id) || null;
        } else if (cleanRelation === 'product_images' && mockData.product_images) {
          result.product_images = mockData.product_images.filter((img: any) => img.product_id === row.id);
        }
      }
    }
    return result;
  }

  async execute(): Promise<any> {
    let result = [...this._data];

    // Apply filters
    for (const filter of this._filters) {
      result = result.filter(item => {
        const itemValue = item[filter.field];
        switch (filter.op) {
          case 'eq':
            return itemValue === filter.value;
          case 'ilike':
            return String(itemValue).toLowerCase().includes(String(filter.value).toLowerCase());
          case 'gte':
            return itemValue >= parseFloat(filter.value);
          case 'lte':
            return itemValue <= parseFloat(filter.value);
          default:
            return true;
        }
      });
    }

    // Apply ordering
    for (const sort of this._order.reverse()) {
      result.sort((a, b) => {
        const aVal = a[sort.field];
        const bVal = b[sort.field];
        const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sort.ascending ? comparison : -comparison;
      });
    }

    const count = result.length;

    // Apply limit
    if (this._limit !== null) {
      result = result.slice(0, this._limit);
    }

    // Apply range
    if (this._range) {
      result = result.slice(this._range[0], this._range[1] + 1);
    }

    // Load relations if selects specified
    if (this._selects) {
      result = result.map(row => this.loadRelations(row, this._selects!));
    }

    if (this._single) {
      return { data: result[0] || null, error: null, count };
    }

    return { data: result, error: null, count };
  }

  then(onFulfilled?: any, onRejected?: any) {
    return this.execute().then(onFulfilled, onRejected);
  }

  [Symbol.toStringTag] = 'Promise';
}

export const supabaseAuth = {
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  getUser: async () => ({ data: { user: null }, error: null }),
};

export const supabaseStorage = {
  from: (bucket: string) => ({
    upload: async (path: string, file: any) => ({ data: null, error: null }),
    getPublicUrl: (path: string) => ({
      data: { publicUrl: `http://localhost:4000/uploads/${path}` },
    }),
    remove: async (paths: string[]) => ({ data: null, error: null }),
  }),
};

export const supabaseMock = {
  auth: supabaseAuth,
  storage: supabaseStorage,
  from: (tableName: string) => new MockQueryBuilder(tableName),
};

export function addMockProduct(product: any) {
  const newId = Math.max(0, ...mockData.products.map(p => p.id)) + 1;
  mockData.products.push({ ...product, id: newId, created_at: new Date().toISOString() });
  return { id: newId, ...product };
}

export function getMockData() {
  return mockData;
}
