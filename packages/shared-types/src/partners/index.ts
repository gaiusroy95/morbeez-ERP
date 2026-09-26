// Master data — the fields the owner app reads, mirroring the backend's
// customers/farmers/products/vehicles/workforce entities.
import type { IsoDateTime } from '../common';

export interface CustomerRecord {
  id: string;
  name: string;
  contact: { phone?: string; email?: string; notes?: string };
  creditLimit: string;
  paymentTermsDays: number;
  status: 'active' | 'archived';
  createdAt: IsoDateTime;
}

export interface FarmerRecord {
  id: string;
  name: string;
  contact: { phone?: string; email?: string; notes?: string };
  reliabilityRating: string | null;
  status: 'active' | 'archived';
  createdAt: IsoDateTime;
}

export interface ProductRecord {
  id: string;
  name: string;
  category: string | null;
  baseUom: 'kg' | 'g' | 'crate' | 'bag' | 'dozen' | 'unit';
  basePrice: string;
  status: 'active' | 'archived';
}

export interface VehicleRecord {
  id: string;
  registrationNumber: string;
  capacityKg: string;
  fuelType: 'diesel' | 'petrol' | 'cng' | 'electric';
  status: 'active' | 'maintenance' | 'disposed';
}

export interface EmployeeRecord {
  id: string;
  name: string;
  roleType: 'driver' | 'warehouse' | 'procurement' | 'finance' | 'other';
  status: 'active' | 'archived';
}
