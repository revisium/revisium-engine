async function main() {
  console.log('Seed completed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
