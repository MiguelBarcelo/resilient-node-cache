export interface PropertyDto {
  id: string;
  listingType: 'SALE' | 'RENT';
  type: 'HOUSE' | 'APARTMENT' | 'LAND';
  address: string;
  bedrooms: number | null;
  baths: number | null;
  squareFeet: number | null;
  lotSize: number;
  listPrice: number;
  status: 'ACTIVE' | 'PENDING' | 'SOLD' | 'RENTED' | 'OFF_MARKET';
}
