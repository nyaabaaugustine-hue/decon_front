export type VehicleStatus = 'active' | 'in_repair' | 'decommissioned' | 'sold';

export interface Driver {
  id: string;
  fullName: string;
  phone: string;
  licenseNumber: string;
  supervisorId: string;
  hireDate: string;
  status: string;
  photoUrl?: string | null;
}

export interface Supervisor {
  id: string;
  fullName: string;
  phone: string;
  region: string;
}

export interface VehicleDocument {
  id: string;
  vehicleId: string;
  docType: 'purchase_invoice' | 'insurance_policy' | 'registration_certificate';
  fileName: string;
  issueDate: string;
  expiryDate: string | null;
  notes: string | null;
}

export interface ServiceLog {
  id: string;
  vehicleId: string;
  serviceDate: string;
  mileageKm: number;
  serviceType: string;
  partsReplaced: string;
  workshop: string;
  cost: number;
}

export interface BatteryLog {
  id: string;
  vehicleId: string;
  installDate: string;
  replacementDate: string | null;
  brand: string;
  supplier: string;
  cost: number;
}

export interface TyreLog {
  id: string;
  vehicleId: string;
  position: 'FL' | 'FR' | 'RL' | 'RR' | 'SPARE';
  installDate: string;
  replacementDate: string | null;
  brand: string;
  cost: number;
}

export interface RevenueEntry {
  id: string;
  vehicleId: string;
  driverId: string;
  tripDate: string;
  tripReference: string;
  route: string;
  client: string;
  amount: number;
}

export interface AccidentReport {
  id: string;
  vehicleId: string;
  driverId: string | null;
  accidentDate: string;
  description: string;
  cost: number;
  driverAtFault: boolean;
}

export interface VehiclePhoto {
  id: string;
  vehicleId: string;
  category: string;
  caption: string;
  takenAt: string;
  imageUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Valuation {
  id: string;
  vehicleId: string;
  valuationDate: string;
  source: string;
  amount: number;
  conditionNotes: string;
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  purchaseDate: string;
  purchasePrice: number;
  status: VehicleStatus;
  currentDriverId: string | null;
}
