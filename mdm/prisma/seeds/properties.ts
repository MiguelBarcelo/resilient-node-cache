import { prisma } from '../../src/config/db';
import { ListingType, PropertyType } from '../../src/generated/prisma/enums';
import { faker } from '@faker-js/faker';

export async function seedProperties() {
  console.log('🏠 Seeding properties...');

  const propertiesData = faker.helpers.multiple(
    () => {
      const listingType = faker.helpers.arrayElement([
        ListingType.SALE,
        ListingType.RENT,
      ]);

      // Object.values(PropertyType)
      const type = faker.helpers.arrayElement([
        PropertyType.HOUSE,
        PropertyType.APARTMENT,
        PropertyType.LAND,
      ]);

      const isLand = type === PropertyType.LAND;

      let bedrooms = 0,
        baths = 0,
        squareFeet = 0;
      if (!isLand) {
        bedrooms = faker.number.int({ min: 1, max: 6 });
        baths = faker.helpers.arrayElement([1, 1.5, 2, 2.5, 3, 3.5]);
        squareFeet = faker.number.float({
          min: 40,
          max: 350,
          fractionDigits: 2,
        });
      }

      const lotSize =
        type === PropertyType.APARTMENT
          ? squareFeet
          : faker.number.float({
              min: Math.max(squareFeet, 60),
              max: 1000,
              fractionDigits: 2,
            });

      const basePrice =
        squareFeet * faker.number.int({ min: 1000, max: 3000 }) +
        lotSize * faker.number.int({ min: 10, max: 30 });

      const listPrice =
        listingType === ListingType.RENT
          ? Math.round(basePrice / 200)
          : Math.round(basePrice);

      return {
        listingType,
        type,
        address: faker.location.streetAddress(),
        bedrooms,
        baths,
        squareFeet,
        lotSize,
        listPrice,
      };
    },
    { count: 200 },
  );

  const result = await prisma.property.createMany({
    data: propertiesData,
  });

  console.log(`Added ${result.count} properties.`);
}
